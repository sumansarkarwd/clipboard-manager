import { useState, useEffect } from "react";
import type { AppSettings } from "../lib/types";
import {
  getSettings,
  saveSettings,
  clearHistory,
  checkAccessibility,
  requestAccessibilityPermission,
} from "../lib/ipc";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [accessibility, setAccessibility] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    getSettings().then(s => setSettings(s));
    isEnabled().then(setAutostart).catch(() => {});
    checkAccessibility().then(setAccessibility);
  }, []);

  if (!settings) {
    return <div className="p-12 text-gray-400 text-[26px]">Loading…</div>;
  }

  const update = (patch: Partial<AppSettings>) =>
    setSettings(s => s ? { ...s, ...patch } : s);

  const handleSave = async () => {
    if (!settings) return;
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAutostart = async (checked: boolean) => {
    setAutostart(checked);
    if (checked) await enable();
    else await disable();
  };

  const handleAccessibility = () => {
    requestAccessibilityPermission();
    setTimeout(() => checkAccessibility().then(setAccessibility), 3000);
  };

  const handleClear = async () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      setTimeout(() => setConfirmingClear(false), 4000);
      return;
    }
    setConfirmingClear(false);
    try {
      await clearHistory();
      setCleared(true);
      setTimeout(() => setCleared(false), 2000);
    } catch (e) {
      console.error("Failed to clear history:", e);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#f0f0f0] font-sans flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-5">
        <h1 className="text-[28px] font-semibold text-gray-800">Settings</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6">

        {/* Behavior */}
        <section>
          <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">Behavior</p>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            <Row label="Launch at login">
              <Toggle checked={autostart} onChange={handleAutostart} />
            </Row>
            <Row label="Capture images">
              <Toggle
                checked={settings.capture_images}
                onChange={v => update({ capture_images: v })}
              />
            </Row>
            <Row label="Max history items">
              <input
                type="number"
                className="w-28 text-[18px] text-right bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                min={10}
                max={10000}
                value={settings.max_items}
                onChange={e => update({ max_items: Number(e.target.value) })}
              />
            </Row>
          </div>
        </section>

        {/* Permissions */}
        <section>
          <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">Permissions</p>
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between gap-4 px-6 py-5">
              <div className="min-w-0">
                <p className={`text-[18px] font-medium ${accessibility ? "text-green-600" : "text-red-500"}`}>
                  {accessibility ? "✓ Accessibility granted" : "✗ Accessibility required for paste"}
                </p>
                <p className="text-[14px] text-gray-400 mt-1.5">Needed to simulate Cmd+V into other apps. Restart after granting.</p>
              </div>
              {!accessibility && (
                <button
                  onClick={handleAccessibility}
                  className="shrink-0 text-[15px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
                >
                  Open Settings →
                </button>
              )}
            </div>
          </div>
        </section>

        {/* History */}
        <section>
          <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">History</p>
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-6 py-5 flex items-center gap-3">
              <button
                onClick={handleClear}
                className="text-[15px] font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-4 py-2.5 transition-colors"
              >
                {confirmingClear ? "Click again to confirm" : "Clear All History"}
              </button>
              {cleared && (
                <span className="text-[14px] text-green-600 font-medium">History cleared</span>
              )}
            </div>
          </div>
        </section>

      </div>

      {/* Footer */}
      <div className="shrink-0 px-8 py-5 border-t border-gray-200 bg-[#f0f0f0] flex justify-end">
        <button
          onClick={handleSave}
          className="px-7 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-[16px] font-semibold shadow-sm transition-colors whitespace-nowrap"
        >
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-5">
      <span className="text-[18px] text-gray-700">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
        checked ? "bg-blue-500" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
