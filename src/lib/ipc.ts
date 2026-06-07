import { invoke } from "@tauri-apps/api/core";
import type { ClipEntry, AppSettings } from "./types";

export const listClips = (limit = 100, offset = 0) =>
  invoke<ClipEntry[]>("list_clips", { limit, offset });

export const searchClips = (query: string, limit = 100) =>
  invoke<ClipEntry[]>("search_clips", { query, limit });

export const deleteClip = (id: number) => invoke<void>("delete_clip", { id });

export const clearHistory = () => invoke<void>("clear_history");

export const getSettings = () => invoke<AppSettings>("get_settings");

export const saveSettings = (settings: AppSettings) =>
  invoke<void>("save_settings", { settings });

export const pasteClip = (id: number, plain = false) =>
  invoke<void>("paste_clip", { id, plain });

export const hidePopup = () => invoke<void>("hide_popup");

export const showSettings = () => invoke<void>("show_settings");

export const checkAccessibility = () => invoke<boolean>("check_accessibility");

export const requestAccessibilityPermission = () =>
  invoke<void>("request_accessibility_permission");
