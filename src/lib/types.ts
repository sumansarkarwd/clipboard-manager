export type ClipKind = "text" | "html" | "image";

export interface ClipEntry {
  id: number;
  kind: ClipKind;
  content?: string;
  image_path?: string;
  source_app?: string;
  hash: string;
  pinned: boolean;
  created_at: number; // unix epoch seconds
}

export interface AppSettings {
  paste_shortcut: string;
  paste_plain_shortcut: string;
  autostart: boolean;
  max_items: number;
  capture_images: boolean;
  exclude_apps: string[];
}
