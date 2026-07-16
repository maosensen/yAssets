//! Collect API lifecycle commands — the Preferences ▸ Collect section.
//!
//! The server itself lives in `crate::collect`; these commands only flip the
//! persisted flag, start/stop the listener, and surface status (including the
//! token, which the user copies into the yClip extension once).

use serde::Serialize;

use crate::collect;
use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Serialize, specta::Type)]
pub struct CollectStatus {
    /// The persisted preference (survives restarts).
    pub enabled: bool,
    /// Whether a listener is actually bound right now.
    pub running: bool,
    /// The bound port (41420-41424), when running.
    pub port: Option<u16>,
    /// Bearer token for the extension; empty until first enabled.
    pub token: String,
}

fn status(app: &tauri::AppHandle, state: &AppState) -> CollectStatus {
    let port = state.collect_port();
    CollectStatus {
        enabled: collect::is_enabled(app),
        running: port.is_some(),
        port,
        token: collect::stored_token(app).unwrap_or_default(),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_collect_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<CollectStatus> {
    Ok(status(&app, &state))
}

#[tauri::command]
#[specta::specta]
pub async fn set_collect_enabled(
    enabled: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<CollectStatus> {
    collect::set_enabled_flag(&app, enabled)?;
    if enabled {
        collect::start(&app).await?;
    } else {
        collect::stop(&app);
    }
    Ok(status(&app, &state))
}

#[tauri::command]
#[specta::specta]
pub async fn regenerate_collect_token(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<CollectStatus> {
    collect::regenerate_token(&app)?;
    // A running server captured the old token at spawn — bounce it. The brief
    // sleep lets the old listener release its port so the same one rebinds.
    if state.collect_port().is_some() {
        collect::stop(&app);
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        collect::start(&app).await?;
    }
    Ok(status(&app, &state))
}
