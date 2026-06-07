import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { Popup } from "./popup/Popup";
import { Settings } from "./settings/Settings";

// Route by Tauri window label embedded in the URL hash
// popup window:   index.html  → Popup
// settings window: index.html#settings → Settings
const isSettings = window.location.hash === "#settings" ||
  new URLSearchParams(window.location.search).get("window") === "settings";

// Tauri sets window label via getCurrent().label — use that as ground truth
async function renderApp() {
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = getCurrentWebviewWindow();
    const label = win.label;
    render(label === "settings");
  } catch {
    render(isSettings);
  }
}

function render(settings: boolean) {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {settings ? <Settings /> : <Popup />}
    </React.StrictMode>
  );
}

renderApp();
