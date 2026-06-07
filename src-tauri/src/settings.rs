use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub paste_shortcut: String,
    pub paste_plain_shortcut: String,
    pub autostart: bool,
    pub max_items: i64,
    pub capture_images: bool,
    pub exclude_apps: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            paste_shortcut: "Control+Alt+V".to_string(),
            paste_plain_shortcut: "Control+Alt+B".to_string(),
            autostart: false,
            max_items: 500,
            capture_images: true,
            exclude_apps: vec![],
        }
    }
}

pub fn load(config_dir: &PathBuf) -> Settings {
    let path = config_dir.join("settings.json");
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(config_dir: &PathBuf, settings: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let path = config_dir.join("settings.json");
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}
