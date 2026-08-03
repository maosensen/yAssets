//! Agent API lifecycle commands — the Preferences ▸ Agent section.
//!
//! Mirrors `commands::collect`: flip the persisted flag, re-apply it to the
//! shared listener, and report status (including the token the user pastes into
//! their MCP client once). The server itself lives in `crate::agent` +
//! `crate::collect`.

use serde::Serialize;

use crate::error::AppResult;
use crate::state::AppState;
use crate::{agent, collect};

/// Where the bundled stdio bridge lives, for clients that cannot speak MCP over
/// HTTP. Relative to the app's resource directory.
const BRIDGE_RESOURCE: &str = "tools/yassets-mcp-bridge.mjs";

#[derive(Debug, Serialize, specta::Type)]
pub struct AgentStatus {
    /// The persisted preference (survives restarts).
    pub enabled: bool,
    /// Whether a listener is actually bound right now — possibly on behalf of
    /// the Collect surface, so check `enabled` too.
    pub running: bool,
    /// The bound port (41420-41424), when running.
    pub port: Option<u16>,
    /// Bearer token for MCP clients; empty until first enabled.
    pub token: String,
    /// Phase A exposes reads only. Flipped when write tools ship.
    pub read_only: bool,
    /// Absolute path of the stdio bridge script, when it shipped with this
    /// build. None means "use the HTTP transport".
    pub bridge_path: Option<String>,
}

fn bridge_path(app: &tauri::AppHandle) -> Option<String> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;
    let path = app
        .path()
        .resolve(BRIDGE_RESOURCE, BaseDirectory::Resource)
        .ok()?;
    // Only advertise a path the user can actually point a client at.
    path.exists().then(|| path.to_string_lossy().into_owned())
}

fn status(app: &tauri::AppHandle, state: &AppState) -> AgentStatus {
    let port = state.collect_port();
    AgentStatus {
        enabled: agent::is_enabled(app),
        running: port.is_some(),
        port,
        token: agent::stored_token(app).unwrap_or_default(),
        read_only: true,
        bridge_path: bridge_path(app),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_agent_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<AgentStatus> {
    Ok(status(&app, &state))
}

#[tauri::command]
#[specta::specta]
pub async fn set_agent_enabled(
    enabled: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<AgentStatus> {
    agent::set_enabled_flag(&app, enabled)?;
    if enabled {
        // Provision the token before the router captures it.
        agent::ensure_token(&app)?;
    }
    collect::reapply(&app).await?;
    if !enabled {
        // The listener may still be up for Collect; the descriptor must not
        // outlive the permission it advertises.
        agent::remove_endpoint_file(&app);
    }
    Ok(status(&app, &state))
}

#[tauri::command]
#[specta::specta]
pub async fn regenerate_agent_token(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<AgentStatus> {
    agent::regenerate_token(&app)?;
    collect::reapply(&app).await?;
    Ok(status(&app, &state))
}
