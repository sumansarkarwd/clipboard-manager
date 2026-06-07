import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ClipEntry } from "../lib/types";
import { listClips, searchClips, pasteClip, deleteClip, hidePopup } from "../lib/ipc";
import "./popup.css";

const DEBOUNCE_MS = 120;

function timeAgo(epochSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSeconds;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "text", label: "Text" },
  { key: "html", label: "Code" },
  { key: "image", label: "Images" },
] as const;

function getTheme(): "dark" | "light" {
  const stored = localStorage.getItem("clipboard-manager-theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function Popup() {
  const [query, setQuery] = useState("");
  const [clips, setClips] = useState<ClipEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [filterKind, setFilterKind] = useState<"all" | "text" | "html" | "image">("all");
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => getTheme());
  const [toast, setToast] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (q: string) => {
      try {
        const results = q.trim() ? await searchClips(q, 200) : await listClips(200);
        let filtered = results;
        if (filterKind !== "all") {
          filtered = results.filter((c) => c.kind === filterKind);
        }
        filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        setClips(filtered);
        setSelected(0);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [filterKind]
  );

  useEffect(() => {
    load(query);
  }, [filterKind]);

  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const unlisten = win.listen("tauri://focus", () => {
      searchRef.current?.focus();
      load(query);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [query, load]);

  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const unlisten = win.listen("tauri://blur", () => {
      hidePopup();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
    load("");
  }, []);

  // Hold Ctrl to preview the selected item (Quick Look style).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control") setPreviewing(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") setPreviewing(false);
    };
    const reset = () => setPreviewing(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", reset);
    };
  }, []);

  // Closing the preview when the selection moves away avoids a stale card.
  const previewClip = previewing ? clips[selected] : undefined;

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(q), DEBOUNCE_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, clips.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (clips[selected]) handlePaste(clips[selected].id, e.shiftKey);
        break;
      case "Escape":
        e.preventDefault();
        hidePopup();
        break;
      case "Delete":
      case "Backspace":
        if (e.metaKey && clips[selected]) {
          e.preventDefault();
          handleDelete(clips[selected].id);
        }
        break;
      case "p":
      case "P":
        if (e.metaKey && clips[selected]) {
          e.preventDefault();
          handlePin(clips[selected].id);
        }
        break;
    }
  };

  const handlePaste = async (id: number, plain = false) => {
    try {
      await pasteClip(id, plain);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async (id: number) => {
    await deleteClip(id);
    showToast("Deleted");
    await load(query);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 1400);
  };

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("clipboard-manager-theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  const handlePin = (id: number) => {
    const clip = clips.find((c) => c.id === id);
    if (clip) {
      clip.pinned = !clip.pinned;
      showToast(clip.pinned ? "Pinned" : "Unpinned");
      clip.pinned && setSelected(0);
      setClips([...clips]);
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const item = listRef.current?.children[selected] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="popup-container" onKeyDown={handleKeyDown}>
      {/* Search */}
      <div className="search-row">
        <div className="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="Search clipboard history…"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="filters">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            className={`pill ${filterKind === key ? "active" : ""}`}
            onClick={() => setFilterKind(key)}
          >
            {label}
          </button>
        ))}
        <span className="count">{clips.length} item{clips.length === 1 ? "" : "s"}</span>
      </div>

      {/* List */}
      <div className="list" ref={listRef}>
        {error && <div style={{ padding: "8px 16px", fontSize: 12, color: "#f87171" }}>{error}</div>}
        {clips.length === 0 && !error && (
          <div className="empty">
            {query ? "No results" : "Nothing copied yet"}
          </div>
        )}
        {clips.map((clip, i) => {
          const isSelected = i === selected;
          const previewText = clip.kind === "html" ? stripHtml(clip.content ?? "") : clip.content ?? "";
          const displayText = clip.kind === "image" ? "Captured image" : previewText;
          const isMono = clip.kind === "html";

          return (
            <div
              key={clip.id}
              className={`item ${isSelected ? "selected" : ""} ${clip.pinned ? "pinned" : ""}`}
              onClick={() => handlePaste(clip.id)}
              onMouseEnter={() => setSelected(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                handleDelete(clip.id);
              }}
              role="option"
              aria-selected={isSelected}
            >
              <div className={`type-icon ${clip.kind === "html" ? "code" : clip.kind}`}>
                {clip.kind === "image" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="16" rx="3" />
                    <circle cx="9" cy="10" r="1.6" />
                    <path d="m21 16-4.5-4.5L7 21" />
                  </svg>
                ) : clip.kind === "html" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m8 7-5 5 5 5m8-10 5 5-5 5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 6h16M4 12h16M4 18h10" />
                  </svg>
                )}
              </div>
              <div className="item-body">
                <div className={`item-title ${isMono ? "mono" : ""}`}>{displayText}</div>
                <div className="item-meta">
                  {clip.source_app && <span>{clip.source_app}</span>}
                  {clip.source_app && <span className="dot" />}
                  <span>{timeAgo(clip.created_at)}</span>
                </div>
              </div>
              {clip.kind === "image" && clip.image_path && (
                <img className="thumb" src={convertFileSrc(clip.image_path)} alt="" />
              )}
              <svg className="pin-badge" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 3a1 1 0 0 1 .94 1.34L15.6 8.1l3.3 3.3a1 1 0 0 1-.46 1.67l-4.94 1.24-3.8 6.07a1 1 0 0 1-1.55.17l-.7-.7 3.46-5.55-4.43-4.43L11 6.4 14.66 3.3A1 1 0 0 1 16 3Z" transform="rotate(45 12 12)" />
              </svg>
              <div className="paste-flash" />
            </div>
          );
        })}
      </div>

      {/* Preview (hold Ctrl) */}
      {previewClip && (
        <div className="preview-overlay">
          <div className="preview-card">
            <div className="preview-head">
              <span className={`preview-kind ${previewClip.kind === "html" ? "code" : previewClip.kind}`}>
                {previewClip.kind === "html" ? "HTML" : previewClip.kind === "image" ? "Image" : "Text"}
              </span>
              <div className="preview-meta">
                {previewClip.source_app && <span>{previewClip.source_app}</span>}
                {previewClip.source_app && <span className="dot" />}
                <span>{timeAgo(previewClip.created_at)}</span>
              </div>
            </div>
            <div className="preview-body">
              {previewClip.kind === "image" && previewClip.image_path ? (
                <img className="preview-image" src={convertFileSrc(previewClip.image_path)} alt="" />
              ) : previewClip.kind === "html" ? (
                <iframe
                  className="preview-frame"
                  sandbox=""
                  srcDoc={previewClip.content ?? ""}
                  title="HTML preview"
                />
              ) : (
                <pre className="preview-text">{previewClip.content}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="footer">
        <span className="hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span className="hint"><kbd>↵</kbd> paste</span>
        <span className="hint optional"><kbd>⇧↵</kbd> plain text</span>
        <span className="hint optional"><kbd>⌘⌫</kbd> delete</span>
        <span className="hint optional"><kbd>⌘P</kbd> pin</span>
        <span className="hint optional"><kbd>⌃</kbd> preview</span>
        <div className="spacer" />
        <span className={`toast ${toast ? "show" : ""}`}>{toast}</span>
        <span className="hint"><kbd>esc</kbd> close</span>
      </div>
    </div>
  );
}
