mod clipboard;
mod commands;
mod db;
mod paste;
mod settings;
mod tray;

use clipboard_rs::{ClipboardHandler, ClipboardWatcher, ClipboardWatcherContext};
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub settings: Arc<Mutex<settings::Settings>>,
    pub prev_app_name: Arc<Mutex<String>>,
}

struct ClipWatcher {
    db: Arc<Mutex<Connection>>,
    settings: Arc<Mutex<settings::Settings>>,
    images_dir: std::path::PathBuf,
}

impl ClipboardHandler for ClipWatcher {
    fn on_clipboard_change(&mut self) {
        let Ok(ctx) = clipboard_rs::ClipboardContext::new() else {
            return;
        };
        if clipboard::is_concealed(&ctx) {
            return;
        }

        let (capture_images, exclude_apps) = {
            let s = self.settings.lock().unwrap();
            (s.capture_images, s.exclude_apps.clone())
        };

        let source = clipboard::frontmost_app();
        if let Some(ref app_name) = source {
            if exclude_apps
                .iter()
                .any(|ex| ex.eq_ignore_ascii_case(app_name))
            {
                return;
            }
        }

        if let Some(entry) =
            clipboard::read_entry(&ctx, capture_images, source, &self.images_dir)
        {
            let conn = self.db.lock().unwrap();
            let max_items = self.settings.lock().unwrap().max_items;
            if let Err(e) = db::upsert(&conn, &entry) {
                eprintln!("DB upsert error: {}", e);
            }
            let _ = db::prune(&conn, max_items);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Register global-shortcut ONCE here with the handler — not again in setup
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // Record which app was frontmost before showing the picker
                        let name = clipboard::frontmost_app().unwrap_or_default();
                        if let Some(state) = app.try_state::<AppState>() {
                            if let Ok(mut guard) = state.prev_app_name.lock() {
                                *guard = name;
                            }
                        }
                        let _ = tray::show_popup(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_clipboard::init())
        .on_window_event(|window, event| {
            // The settings window is created once and reused. If we let the OS
            // close button destroy it, `get_webview_window("settings")` returns
            // None afterwards and it can never be reopened. Hide instead.
            if window.label() == "settings" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = app.path().app_data_dir()?;
            let config_dir = app.path().app_config_dir()?;
            let images_dir = data_dir.join("images");
            std::fs::create_dir_all(&images_dir)?;

            let conn = db::open(&data_dir)?;
            let conn = Arc::new(Mutex::new(conn));
            let loaded_settings = settings::load(&config_dir);
            let settings_arc = Arc::new(Mutex::new(loaded_settings));

            app.manage(AppState {
                db: Arc::clone(&conn),
                settings: Arc::clone(&settings_arc),
                prev_app_name: Arc::new(Mutex::new(String::new())),
            });

            // System tray
            tray::setup(app.handle())?;

            // Clipboard watcher on a background thread
            let watcher_db = Arc::clone(&conn);
            let watcher_settings = Arc::clone(&settings_arc);
            let watcher_images = images_dir.clone();
            std::thread::spawn(move || {
                let handler = ClipWatcher {
                    db: watcher_db,
                    settings: watcher_settings,
                    images_dir: watcher_images,
                };
                match ClipboardWatcherContext::new() {
                    Ok(mut watcher) => {
                        watcher.add_handler(handler);
                        watcher.start_watch();
                    }
                    Err(e) => eprintln!("Clipboard watcher error: {}", e),
                }
            });

            // Register keyboard shortcuts (plugin was already added above with handler)
            let (shortcut_str, plain_shortcut_str) = {
                let s = settings_arc.lock().unwrap();
                (s.paste_shortcut.clone(), s.paste_plain_shortcut.clone())
            };

            let gs = app.global_shortcut();
            if let Err(e) = gs.register(shortcut_str.as_str()) {
                eprintln!("Failed to register paste shortcut '{}': {}", shortcut_str, e);
            }
            if let Err(e) = gs.register(plain_shortcut_str.as_str()) {
                eprintln!("Failed to register plain shortcut '{}': {}", plain_shortcut_str, e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_clips,
            commands::search_clips,
            commands::delete_clip,
            commands::clear_history,
            commands::get_settings,
            commands::save_settings,
            commands::paste_clip,
            commands::show_popup,
            commands::hide_popup,
            commands::show_settings,
            commands::check_accessibility,
            commands::request_accessibility_permission,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
