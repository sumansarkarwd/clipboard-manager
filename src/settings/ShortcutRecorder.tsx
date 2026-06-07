import { useState, useRef } from "react";

function jsKeyToTauri(key: string): string {
  const map: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Enter: "Return",
    Escape: "Escape",
    Backspace: "Backspace",
    Delete: "Delete",
    Tab: "Tab",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    PrintScreen: "PrintScreen",
  };
  if (map[key]) return map[key];
  if (/^F\d+$/.test(key)) return key;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function tauriToDisplay(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      switch (part) {
        case "CommandOrControl":
        case "CmdOrCtrl":
        case "Command":
        case "Cmd":       return "⌘";
        case "Shift":     return "⇧";
        case "Alt":
        case "Option":    return "⌥";
        case "Control":
        case "Ctrl":      return "⌃";
        case "Return":    return "↵";
        case "Backspace": return "⌫";
        case "Delete":    return "⌦";
        case "Escape":    return "⎋";
        case "Space":     return "Space";
        case "Up":        return "↑";
        case "Down":      return "↓";
        case "Left":      return "←";
        case "Right":     return "→";
        default:          return part;
      }
    })
    .join(" ");
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt"]);

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function ShortcutRecorder({ value, onChange }: Props) {
  const [recording, setRecording] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const startRecording = () => {
    setRecording(true);
    // macOS WKWebView does not keyboard-focus buttons on click — must do it explicitly
    setTimeout(() => btnRef.current?.focus(), 0);
  };

  const stopRecording = () => {
    setRecording(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      stopRecording();
      btnRef.current?.blur();
      return;
    }

    if (MODIFIER_KEYS.has(e.key)) return;

    const parts: string[] = [];
    if (e.metaKey) parts.push("CommandOrControl");
    else if (e.ctrlKey) parts.push("Control");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    parts.push(jsKeyToTauri(e.key));

    onChange(parts.join("+"));
    stopRecording();
    btnRef.current?.blur();
  };

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={startRecording}
      onKeyDown={handleKeyDown}
      onBlur={stopRecording}
      className={[
        "min-w-[180px] px-3 py-1.5 rounded-lg border text-sm font-mono text-left",
        "transition-all outline-none select-none",
        recording
          ? "border-blue-400 bg-blue-50 ring-2 ring-blue-300"
          : "border-gray-300 bg-white text-gray-800 hover:border-gray-400",
      ].join(" ")}
    >
      {recording ? (
        <span className="text-blue-500 animate-pulse">Press keys…  (Esc to cancel)</span>
      ) : value ? (
        <span className="text-gray-800">{tauriToDisplay(value)}</span>
      ) : (
        <span className="text-gray-400">Click to record</span>
      )}
    </button>
  );
}
