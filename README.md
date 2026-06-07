# Clipboard Manager

A lightweight, keyboard-driven clipboard manager for macOS built with Tauri v2, Rust, and React.

## Features

- **Clipboard History** — Automatically captures clipboard items (text, images, and HTML)
- **Fast Search** — Full-text search with FTS5, ranked prefix queries
- **Keyboard Navigation** — Arrow keys to navigate, Enter to paste, Esc to close
- **Multiple Paste Modes** — Rich paste (preserves HTML) or plain text paste
- **Global Shortcuts** — Configurable hotkeys to open the popup (default: `Control+Alt+V` for paste, `Control+Alt+B` for plain paste)
- **Pin Items** — Pin frequently used items for quick access
- **Kind Filters** — Filter by Text, Code, or Images
- **Dark/Light Theme** — Toggle theme preference
- **Settings Window** — Customize shortcuts, max history size, image capture, and exclusions
- **Auto-exclusions** — Skip clipboard captures from password managers and excluded apps
- **Image Support** — Captures and pastes images as PNG files
- **Autostart** — Optional app autostart on login

## Requirements

- macOS 10.13 or later
- Accessibility permission (required for paste functionality)

## Development Setup

### Prerequisites

- Node.js 18+
- Rust (for Tauri backend)
- Xcode Command Line Tools

### Installation

```bash
npm install
```

### Commands

```bash
# Full dev mode (starts Vite + Rust, hot-reloads frontend)
npm run tauri dev

# Production build
npm run tauri build

# Build .app and install to /Applications (quits any running instance first)
./build.sh

# Frontend only (no Tauri, useful for UI iteration)
npm run dev

# TypeScript type check
npx tsc --noEmit
```

## Architecture

This is a two-window, single-entry-point Tauri app:

- **Rust Backend** (`src-tauri/src/`) — Clipboard watcher, system integrations, database, paste sequencing
- **React Frontend** (`src/`) — Popup window (keyboard-driven list) and settings window
- **Storage** — SQLite database with FTS5 full-text search, images stored as PNG files

The **popup window** is keyboard-driven:
- `↑↓` — Navigate items
- `Enter` — Paste selected item (rich HTML/images)
- `Shift+Enter` — Paste as plain text
- `Cmd+Delete` — Delete item
- `Cmd+P` — Pin item
- `Esc` — Close popup

The **settings window** allows configuration of:
- Global keyboard shortcuts
- Maximum clipboard history size (default: 500 items)
- Image capture toggle
- Excluded apps (to skip clipboard capture)

## Known Limitations

- **macOS only** — Uses AppKit and Accessibility APIs unavailable on other platforms
- **Pinning is UI-local** — Pin state does not persist (resets on app reload)

## License

TBD
