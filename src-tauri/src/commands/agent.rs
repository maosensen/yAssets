//! Agent API lifecycle commands — the Preferences ▸ Agent section.
//!
//! Mirrors `commands::collect`: flip the persisted flag, re-apply it to the
//! shared listener, and report status (including the token the user pastes into
//! their MCP client once). The server itself lives in `crate::agent` +
//! `crate::collect`.

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::{agent, collect};

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
    /// False since writes shipped. Kept on the wire so the Preferences badge and
    /// any client can state the surface's reach without hardcoding a version.
    pub read_only: bool,
    /// Absolute path of the stdio bridge script, when it shipped with this
    /// build. None means "use the HTTP transport".
    pub bridge_path: Option<String>,
}

fn status(app: &tauri::AppHandle, state: &AppState) -> AgentStatus {
    let port = state.collect_port();
    AgentStatus {
        enabled: agent::is_enabled(app),
        running: port.is_some(),
        port,
        token: agent::stored_token(app).unwrap_or_default(),
        read_only: false,
        bridge_path: agent::connect::bridge_path(app),
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

// ------------------------------------------------------- one-click connect ---

/// One MCP client's install/connection state, as far as we can see it.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AgentTargetStatus {
    /// The client appears to exist on this machine (binary or config dir).
    pub detected: bool,
    /// Its config registers our server. Both connectors go through the stdio
    /// bridge, so a token rotation does NOT unset this — the bridge re-reads
    /// the endpoint descriptor per call.
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AgentConnections {
    pub claude_code: AgentTargetStatus,
    pub codex: AgentTargetStatus,
    /// Node.js was found — the bridge (and therefore one-click) needs it.
    pub node_ok: bool,
    /// This build ships the bridge script (false only in broken installs).
    pub bridge_ok: bool,
}

fn connections(app: &tauri::AppHandle) -> AgentConnections {
    AgentConnections {
        claude_code: AgentTargetStatus {
            detected: agent::connect::find_claude().is_some(),
            connected: agent::connect::claude_connected(),
        },
        codex: AgentTargetStatus {
            detected: agent::connect::codex_detected(),
            connected: agent::connect::codex_connected(),
        },
        node_ok: agent::connect::find_node().is_some(),
        bridge_ok: agent::connect::bridge_path(app).is_some(),
    }
}

/// Filesystem scans + config reads — cheap, but off the main thread anyway.
#[tauri::command]
#[specta::specta]
pub async fn get_agent_connections(app: tauri::AppHandle) -> AppResult<AgentConnections> {
    tauri::async_runtime::spawn_blocking(move || Ok(connections(&app)))
        .await
        .map_err(|_| AppError::Internal)?
}

fn required_bridge(app: &tauri::AppHandle) -> AppResult<String> {
    agent::connect::bridge_path(app).ok_or_else(|| {
        AppError::Conflict(
            "this build is missing the bundled bridge script — reinstall yAssets".into(),
        )
    })
}

/// Register the server with Claude Code (spawns `claude mcp add`, user scope).
#[tauri::command]
#[specta::specta]
pub async fn connect_claude_code(app: tauri::AppHandle) -> AppResult<AgentConnections> {
    let bridge = required_bridge(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        agent::connect::connect_claude(&bridge)?;
        Ok(connections(&app))
    })
    .await
    .map_err(|_| AppError::Internal)?
}

/// Register the server with Codex (upserts `~/.codex/config.toml`).
#[tauri::command]
#[specta::specta]
pub async fn connect_codex(app: tauri::AppHandle) -> AppResult<AgentConnections> {
    let bridge = required_bridge(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        agent::connect::connect_codex(&bridge)?;
        Ok(connections(&app))
    })
    .await
    .map_err(|_| AppError::Internal)?
}
