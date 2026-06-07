#!/bin/bash
set -e

APP_NAME="Clipboard Manager"
APP_SRC="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
APP_DST="/Applications/${APP_NAME}.app"

echo "→ Quitting any running instance..."
pkill -x "${APP_NAME}" 2>/dev/null && sleep 1 || true

echo "→ Building (this takes ~2 min)..."
npm run tauri build

if [ ! -d "${APP_SRC}" ]; then
  echo "✗ App bundle not found: ${APP_SRC}"
  exit 1
fi

echo "→ Installing to /Applications..."
rm -rf "${APP_DST}"
cp -R "${APP_SRC}" "${APP_DST}"

echo ""
echo "✓ Done! Installed to ${APP_DST}"
echo "  Launch: open '${APP_DST}'"
