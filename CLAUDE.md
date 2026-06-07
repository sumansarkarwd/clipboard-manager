# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Full dev mode (starts Vite + Rust, hot-reloads frontend)
npm run tauri dev

# Production build
npm run tauri build

# Build .app and install to /Applications (quits any running instance first)
./build.sh

# Frontend only (no Tauri, useful for UI iteration — most native features will be unavailable)
npm run dev

# TypeScript type check
npx tsc --noEmit
```

There are no automated tests in this codebase. To verify behavior, run the app with `npm run tauri dev`. This is a macOS-only app — it relies on AppKit, Accessibility permissions, and `osascript`/`open`.

## Architecture

This is a macOS clipboard manager built with Tauri v2 (Rust backend) + React 19 / TypeScript (frontend). Styling is split: the popup uses a hand-written stylesheet ([popup.css](src/popup/popup.css)), the settings window uses Tailwind v4 utility classes.

### Two-window, single-entry-point pattern

Both the popup and settings windows load the same `index.html`. [main.tsx](src/main.tsx) inspects the Tauri window label at runtime and renders either `<Popup>` or `<Settings>`. When adding a new window, define it in [tauri.conf.json](src-tauri/tauri.conf.json) and add a branch in `main.tsx`.

The **settings window is created once and hidden, never destroyed** — its close button is intercepted in `lib.rs` (`on_window_event` → `prevent_close` + `hide`). If it were allowed to close, `get_webview_window("settings")` would return `None` and it could never be reopened.

### Rust backend (`src-tauri/src/`)

| Module | Responsibility |
|---|---|
| `lib.rs` | App bootstrap: registers plugins, sets macOS Accessory policy (no dock icon), opens DB, loads settings, builds `AppState`, sets up tray, spawns the clipboard watcher thread, registers global shortcuts. The global-shortcut plugin is registered **once** here with its handler |
| `clipboard.rs` | Reads from system clipboard (priority: HTML > text > image), detects concealed pasteboard types, resolves frontmost app via AppKit |
| `db.rs` | SQLite via rusqlite (WAL mode). Schema: `clips` table + `clips_fts` FTS5 virtual table kept in sync by AFTER INSERT/DELETE triggers. Deduplication by `hash` UNIQUE constraint (upsert on conflict bumps `created_at` to re-surface the item). `search()` runs a ranked FTS5 prefix query and falls back to `LIKE`. `prune()` enforces `max_items`, never deleting `pinned` rows |
| `commands.rs` | All Tauri `invoke` handlers. Also holds the paste sequencing logic and an HTML→text stripper (`html2text`) for plain paste |
| `paste.rs` | Uses `enigo` to simulate Cmd+V. Writes the chosen entry to the system clipboard, reactivates the prior app via `open -a`, checks/requests macOS Accessibility permission. `simulate_paste` must run on the main thread |
| `settings.rs` | `Settings` struct persisted as JSON in the app config dir. Defaults: shortcuts `Control+Alt+V` / `Control+Alt+B`, `max_items` 500, `capture_images` true |
| `tray.rs` | System tray icon and menu; `show_popup` positions via `tauri-plugin-positioner` |

`AppState` has **three** fields, all behind `Arc<Mutex<_>>`: `db`, `settings`, and `prev_app_name`. It is managed by Tauri and injected into every command handler.

### Frontend (`src/`)

- [ipc.ts](src/lib/ipc.ts) — single file with all `invoke()` calls; import from here, not directly from `@tauri-apps/api`
- [types.ts](src/lib/types.ts) — shared types (`ClipEntry`, `AppSettings`) that mirror the Rust structs; keep them in sync by hand
- [Popup.tsx](src/popup/Popup.tsx) — keyboard-driven list (↑↓ navigate, Enter paste, Shift+Enter paste plain, Cmd+Delete delete, Cmd+P pin, Esc close), search box with FTS, kind filters (All/Text/Code/Images), theme toggle in `localStorage`. Reloads on `tauri://focus`, hides on `tauri://blur`
- [Settings.tsx](src/settings/Settings.tsx) — settings form; autostart is managed directly via `@tauri-apps/plugin-autostart` (not through `save_settings`)
- [ShortcutRecorder.tsx](src/settings/ShortcutRecorder.tsx) — captures a keypress and maps JS key names to the Tauri accelerator format (e.g. `ArrowUp` → `Up`, `Enter` → `Return`) used by the settings form

### Data flow for paste

1. User presses a global shortcut → the handler in `lib.rs` records the frontmost app into `AppState.prev_app_name`, then shows the popup. **Both** the paste and plain-paste shortcuts do the same thing (show the popup); the plain-vs-rich distinction is made at paste time, not by which shortcut opened the popup.
2. User selects an item → `paste_clip(id, plain)`. The command checks Accessibility first, loads the entry, hides the popup, then spawns a background thread that: sleeps 150ms → `open -a <prev_app>` to reactivate the prior app → sleeps 250ms → **writes the entry to the system clipboard** → runs `simulate_paste` (Cmd+V) on the main thread.
3. `plain` mode strips HTML to text via `html2text`; otherwise HTML pastes as HTML, text as text, images via their PNG path.
4. Requires macOS Accessibility permission; `paste.rs` checks via the AppKit trust API and requests it through System Settings.

### Clipboard capture

`ClipWatcher` (in `lib.rs`) runs on a background thread using `clipboard-rs`. On each change it: skips concealed pasteboard types (password managers), skips apps in the `exclude_apps` list (case-insensitive), reads the entry (HTML > text > image), upserts to SQLite, then prunes to `max_items`. Images are saved as PNG files in `{app_data_dir}/images/` keyed by their blake3 hash.

### Storage locations

- App config dir (`~/Library/Application Support/co.codebuddy.clipboardmanager/settings.json`) — user settings
- App data dir (same base) — `history.db` (SQLite, WAL) and `images/`

## Known gotchas

- **Pinning is UI-local only and does not persist.** [handlePin](src/popup/Popup.tsx#L189) mutates the in-memory clip and shows a toast, but there is no pin IPC command. `upsert` always writes `pinned = 0`, so the `pinned` column is never actually set, `prune()`'s pin protection never triggers, and the pin state resets on the next reload. Wiring up pinning means adding a `set_pinned` command (commands.rs → `invoke_handler!` in lib.rs → ipc.ts) and calling it from `handlePin`.
- `save_settings` re-registers the global shortcuts when they change (unregister old, register new) — changing a shortcut does not require an app restart, but a failed registration is only logged to stderr.

## Conventions / style guidelines

Match the existing code; the patterns below are already followed throughout.

**Rust**
- Command handlers return `Result<T, String>`; convert errors with `.map_err(|e| e.to_string())`. Lock mutexes the same way (`.lock().map_err(...)`).
- Keep DB access in `db.rs` (pure functions taking `&Connection`), IPC surface in `commands.rs`, and bootstrap/wiring in `lib.rs`. Don't inline SQL into command handlers.
- Comments explain **why**, not what — non-obvious ordering, timing, and platform constraints get a comment (see the paste-sequence and settings-window-hide comments). Don't narrate obvious code.
- Anything touching the macOS UI run loop (enigo/CGEvent) must run on the main thread via `run_on_main_thread`; do timing/sleeps off the main thread.

**TypeScript / React**
- All `invoke()` calls go through [ipc.ts](src/lib/ipc.ts) as typed wrappers — components never import `@tauri-apps/api/core` directly for commands.
- Keep [types.ts](src/lib/types.ts) in sync with the Rust structs by hand (snake_case field names match the serde output).
- Function components with hooks; co-locate component-specific CSS (popup) or use Tailwind utilities inline (settings) — follow whichever the window already uses, don't mix.

### Adding a new Tauri command

1. Add a `#[tauri::command]` fn in [commands.rs](src-tauri/src/commands.rs)
2. Register it in the `invoke_handler!` macro in [lib.rs](src-tauri/src/lib.rs)
3. Add a typed wrapper in [ipc.ts](src/lib/ipc.ts)
