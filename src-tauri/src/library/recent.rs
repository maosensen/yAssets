//! Recently-opened libraries, persisted app-side via tauri-plugin-store
//! (`settings.json` under the app config/data dir).
//!
//! This is app state, not library state — it survives library switches and
//! lives outside any library folder. The frontend reads it through the
//! `list_recent_libraries` command; it never touches the store directly.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};
use crate::library::{LibraryInfo, LIBRARY_JSON};

const STORE_FILE: &str = "settings.json";
const KEY_RECENT: &str = "recent_libraries";
const KEY_LAST_LIBRARY: &str = "last_library_path";
const MAX_RECENT: usize = 10;

/// Persisted shape (internal).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedRecent {
    path: String,
    name: String,
    /// Unix ms.
    last_opened_at: i64,
}

/// IPC shape — `missing` is computed at list time so the welcome screen can
/// grey out libraries whose folder has moved or been deleted.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RecentLibrary {
    pub path: String,
    pub name: String,
    /// Unix ms.
    pub last_opened_at: f64,
    pub missing: bool,
}

fn load(app: &AppHandle) -> AppResult<Vec<PersistedRecent>> {
    let store = open_store(app)?;
    let Some(value) = store.get(KEY_RECENT) else {
        return Ok(Vec::new());
    };
    // A corrupt entry must never brick startup — fall back to empty.
    Ok(serde_json::from_value(value).unwrap_or_else(|err| {
        log::warn!("recent_libraries unreadable, resetting: {err}");
        Vec::new()
    }))
}

fn save(app: &AppHandle, list: &[PersistedRecent]) -> AppResult<()> {
    let store = open_store(app)?;
    let value = serde_json::to_value(list)?;
    store.set(KEY_RECENT, value);
    store.save().map_err(|err| {
        log::error!("failed to persist recent libraries: {err}");
        AppError::Internal
    })
}

fn open_store(app: &AppHandle) -> AppResult<std::sync::Arc<tauri_plugin_store::Store<tauri::Wry>>> {
    app.store(STORE_FILE).map_err(|err| {
        log::error!("failed to open settings store: {err}");
        AppError::Internal
    })
}

/// Move `info` to the front of the recent list (dedup by path, cap at 10).
pub fn remember(app: &AppHandle, info: &LibraryInfo) -> AppResult<()> {
    let mut list = load(app)?;
    list.retain(|entry| entry.path != info.path);
    list.insert(
        0,
        PersistedRecent {
            path: info.path.clone(),
            name: info.name.clone(),
            last_opened_at: crate::library::now_ms(),
        },
    );
    list.truncate(MAX_RECENT);
    save(app, &list)
}

/// Recent libraries, most recent first, with liveness check.
pub fn list(app: &AppHandle) -> AppResult<Vec<RecentLibrary>> {
    Ok(load(app)?
        .into_iter()
        .map(|entry| {
            let missing = !std::path::Path::new(&entry.path)
                .join(LIBRARY_JSON)
                .is_file();
            RecentLibrary {
                path: entry.path,
                name: entry.name,
                last_opened_at: entry.last_opened_at as f64,
                missing,
            }
        })
        .collect())
}

/// Drop one entry by path (user removed it from the welcome screen).
pub fn remove(app: &AppHandle, path: &str) -> AppResult<()> {
    let mut list = load(app)?;
    list.retain(|entry| entry.path != path);
    save(app, &list)
}

/// Remember (or clear) the library to auto-reopen on next launch.
pub fn set_last_library(app: &AppHandle, path: Option<&str>) -> AppResult<()> {
    let store = open_store(app)?;
    match path {
        Some(path) => store.set(KEY_LAST_LIBRARY, serde_json::json!(path)),
        None => {
            store.delete(KEY_LAST_LIBRARY);
        }
    }
    store.save().map_err(|err| {
        log::error!("failed to persist last library: {err}");
        AppError::Internal
    })
}

/// The library to auto-reopen on launch, if any.
pub fn last_library(app: &AppHandle) -> Option<String> {
    let store = open_store(app).ok()?;
    store
        .get(KEY_LAST_LIBRARY)
        .and_then(|value| value.as_str().map(|s| s.to_string()))
}
