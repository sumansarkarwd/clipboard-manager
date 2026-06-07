use tauri::{AppHandle, Manager, State};

use crate::db::{self, ClipEntry};
use crate::paste;
use crate::settings::Settings;
use crate::AppState;

#[tauri::command]
pub fn list_clips(
    state: State<AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<ClipEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list(&conn, limit.unwrap_or(100), offset.unwrap_or(0)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_clips(
    state: State<AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<ClipEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if query.trim().is_empty() {
        db::list(&conn, limit.unwrap_or(100), 0).map_err(|e| e.to_string())
    } else {
        db::search(&conn, &query, limit.unwrap_or(100)).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn delete_clip(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::clear(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: Settings,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;

    // Capture old shortcuts before overwriting state
    let (old_paste, old_plain) = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        (s.paste_shortcut.clone(), s.paste_plain_shortcut.clone())
    };

    crate::settings::save(&config_dir, &settings)?;

    // Re-register shortcuts if they changed
    let gs = app.global_shortcut();
    if settings.paste_shortcut != old_paste {
        let _ = gs.unregister(old_paste.as_str());
        if let Err(e) = gs.register(settings.paste_shortcut.as_str()) {
            eprintln!("Failed to register shortcut '{}': {}", settings.paste_shortcut, e);
        }
    }
    if settings.paste_plain_shortcut != old_plain {
        let _ = gs.unregister(old_plain.as_str());
        if let Err(e) = gs.register(settings.paste_plain_shortcut.as_str()) {
            eprintln!("Failed to register shortcut '{}': {}", settings.paste_plain_shortcut, e);
        }
    }

    *state.settings.lock().map_err(|e| e.to_string())? = settings;
    Ok(())
}

#[tauri::command]
pub fn paste_clip(
    app: AppHandle,
    state: State<AppState>,
    id: i64,
    plain: bool,
) -> Result<(), String> {
    if !paste::is_accessibility_trusted() {
        paste::request_accessibility();
        return Err("Accessibility permission required. Grant it in System Settings and restart the app.".to_string());
    }

    let entry = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_by_id(&conn, id).map_err(|e| e.to_string())?.ok_or("Entry not found")?
    };

    // Hide popup so the previously-focused app can regain focus
    if let Some(popup) = app.get_webview_window("popup") {
        let _ = popup.hide();
    }

    // Determine what to paste
    enum PasteAction {
        Text(String),
        Html(String),
        Image(String),
        SimulateOnly,
    }
    let action = if plain {
        let text = match entry.kind.as_str() {
            "html" => html2text(entry.content.as_deref().unwrap_or("")),
            _ => entry.content.as_deref().unwrap_or("").to_string(),
        };
        PasteAction::Text(text)
    } else if entry.kind == "html" {
        PasteAction::Html(entry.content.unwrap_or_default())
    } else if entry.kind == "text" {
        PasteAction::Text(entry.content.unwrap_or_default())
    } else if entry.kind == "image" {
        match entry.image_path {
            Some(path) => PasteAction::Image(path),
            None => PasteAction::SimulateOnly,
        }
    } else {
        PasteAction::SimulateOnly
    };

    let prev_app = state.prev_app_name.lock().map(|g| g.clone()).unwrap_or_default();

    // Paste sequence (all timing off the main thread so the UI run loop stays free):
    //   1. Sleep 150ms → popup finishes hiding, focus starts returning
    //   2. `open -a <AppName>` reactivates the previously-focused app
    //   3. Sleep 250ms → app activation settles
    //   4. Write the clipboard (safe from a background thread)
    //   5. Simulate Cmd+V on the main thread (enigo/CGEvent requires it); the
    //      keystroke fn waits for the pasteboard to settle before firing
    let handle = app.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        paste::activate_app(&prev_app);
        std::thread::sleep(std::time::Duration::from_millis(250));

        let write = match &action {
            PasteAction::Text(t) => paste::set_clipboard_text(t),
            PasteAction::Html(h) => paste::set_clipboard_html(h),
            PasteAction::Image(p) => paste::set_clipboard_image(p),
            PasteAction::SimulateOnly => Ok(()),
        };
        if let Err(e) = write {
            eprintln!("Failed to write clipboard before paste: {}", e);
            return;
        }

        let _ = handle.run_on_main_thread(move || {
            let _ = paste::simulate_paste();
        });
    });

    Ok(())
}

fn html2text(html: &str) -> String {
    // Very simple HTML tag stripper — good enough for plain-text paste
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

#[tauri::command]
pub fn show_popup(app: AppHandle) -> Result<(), String> {
    crate::tray::show_popup(&app)
}

#[tauri::command]
pub fn hide_popup(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("popup") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_settings(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn check_accessibility() -> bool {
    paste::is_accessibility_trusted()
}

#[tauri::command]
pub fn request_accessibility_permission() {
    paste::request_accessibility();
}
