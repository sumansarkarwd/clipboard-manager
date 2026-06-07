#[cfg(not(target_os = "macos"))]
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::time::Duration;

// Give the pasteboard time to commit before the keystroke is delivered to the
// target app. Without this, Cmd+V can fire before the app sees the new content.
const PASTEBOARD_SETTLE: Duration = Duration::from_millis(90);

pub fn set_clipboard_text(text: &str) -> Result<(), String> {
    use clipboard_rs::{Clipboard, ClipboardContext};
    let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
    ctx.set_text(text.to_string()).map_err(|e| e.to_string())
}

pub fn set_clipboard_html(html: &str) -> Result<(), String> {
    use clipboard_rs::common::ClipboardContent;
    use clipboard_rs::{Clipboard, ClipboardContext};
    let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
    let plain = strip_tags(html);
    // Put BOTH an HTML representation and a plain-text fallback on the pasteboard.
    // Apps that accept HTML keep the formatting; apps that only read plain text
    // (terminals, code editors, plain text fields) still get the content.
    ctx.set(vec![
        ClipboardContent::Html(html.to_string()),
        ClipboardContent::Text(plain),
    ])
    .map_err(|e| e.to_string())
}

pub fn set_clipboard_image(image_path: &str) -> Result<(), String> {
    use clipboard_rs::common::{RustImage, RustImageData};
    use clipboard_rs::{Clipboard, ClipboardContext};
    let img = RustImageData::from_path(image_path)
        .map_err(|e| format!("image load error: {e:?}"))?;
    let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
    ctx.set_image(img).map_err(|e| e.to_string())
}

fn strip_tags(html: &str) -> String {
    let mut out = String::new();
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

// macOS virtual keycode for the 'v' key (ANSI_V).
#[cfg(target_os = "macos")]
const KEYCODE_V: core_graphics::event::CGKeyCode = 0x09;

/// Simulate Cmd+V.
///
/// On macOS we post the keystroke via Core Graphics with the Command flag set
/// *directly on the 'v' event*. enigo posts the modifier as a separate keydown
/// and relies on the OS to combine it with the 'v' event — a race that
/// intermittently produces a literal "v" instead of a paste. Setting the flag on
/// the event itself removes that race entirely.
#[cfg(target_os = "macos")]
pub fn simulate_paste() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    // Let the pasteboard write settle before sending the keystroke.
    std::thread::sleep(PASTEBOARD_SETTLE);

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "failed to create CGEventSource".to_string())?;

    let key_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_V, true)
        .map_err(|_| "failed to create key-down event".to_string())?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);

    std::thread::sleep(Duration::from_millis(20));

    let key_up = CGEvent::new_keyboard_event(source, KEYCODE_V, false)
        .map_err(|_| "failed to create key-up event".to_string())?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn simulate_paste() -> Result<(), String> {
    std::thread::sleep(PASTEBOARD_SETTLE);
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.key(Key::Meta, Direction::Press).map_err(|e| e.to_string())?;
    enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
    enigo.key(Key::Meta, Direction::Release).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn activate_app(name: &str) {
    if name.is_empty() { return; }
    // `open -a <Name>` brings the app to the foreground without relaunching it
    let _ = std::process::Command::new("open")
        .args(["-a", name])
        .spawn();
}

#[cfg(target_os = "macos")]
pub fn is_accessibility_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    unsafe { AXIsProcessTrusted() }
}

#[cfg(not(target_os = "macos"))]
pub fn is_accessibility_trusted() -> bool {
    true
}

#[cfg(target_os = "macos")]
pub fn request_accessibility() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}

#[cfg(not(target_os = "macos"))]
pub fn request_accessibility() {}
