//! Local Agent API — the read-only surface AI coding agents (Claude Code,
//! Codex) use to browse and reason about the library.
//!
//! It rides on the same loopback listener as the Collect API (`crate::collect`)
//! but is a **separate surface**: its own enable flag, its own bearer token, its
//! own routes under `/api/agent/*` plus an MCP endpoint at `/mcp`. Revoking
//! agent access therefore never disturbs the yClip browser extension, and vice
//! versa.
//!
//! Why route agents through the running app instead of letting them open the
//! library's SQLite directly:
//!
//! - writes are serialized by an in-process writer mutex (`Library::write`); an
//!   external writer bypasses it;
//! - the UI refreshes off query invalidation / typed events, so an outside
//!   mutation leaves every open view showing stale rows;
//! - thumbnails, the FTS index, dHash and palettes are derived data maintained
//!   by the import pipeline — a raw INSERT produces half-cataloged assets.
//!
//! Phase A is read-only; writes (with dry-run + an audit trail) come later, so
//! everything here goes through `Library::read`.

pub mod api;
pub mod connect;
pub mod dto;
pub mod mcp;
pub mod routes;

use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};

const STORE_FILE: &str = "settings.json";
const KEY_ENABLED: &str = "agent_enabled";
const KEY_TOKEN: &str = "agent_token";

/// Descriptor the stdio bridge reads so it needs no hardcoded port or token.
/// Written next to `settings.json` (which already holds the token in plain
/// text, so this adds no new exposure) and removed when the server stops.
const ENDPOINT_FILE: &str = "agent-endpoint.json";

/// Wire version of the agent surface. Bumped only on a breaking change to the
/// DTOs or the tool contract; clients feature-detect via `GET /api/agent/info`.
pub const AGENT_API_VERSION: u32 = 1;

/// Per-request context for the agent routes. Generic over the Tauri runtime so
/// tests can drive the router with `tauri::test::MockRuntime`.
pub struct AgentCtx<R: tauri::Runtime = tauri::Wry> {
    pub app: tauri::AppHandle<R>,
    pub token: String,
    /// Whether this surface is switched on. Baked in at spawn — the listener is
    /// shared with Collect, and every flag or token change bounces it
    /// (`collect::reapply`), so there is nothing to re-read per request.
    pub enabled: bool,
}

// Hand-written: a derive would demand `R: Clone`, which `tauri::Runtime` does
// not promise (same reason `CollectCtx` spells its Clone out).
impl<R: tauri::Runtime> Clone for AgentCtx<R> {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            token: self.token.clone(),
            enabled: self.enabled,
        }
    }
}

fn open_store<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> AppResult<std::sync::Arc<tauri_plugin_store::Store<R>>> {
    app.store(STORE_FILE).map_err(|err| {
        log::error!("failed to open settings store: {err}");
        AppError::Internal
    })
}

/// Whether the user has the agent surface switched on. Off by default — an
/// agent-reachable library is opt-in, never a default.
pub fn is_enabled<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    open_store(app)
        .ok()
        .and_then(|store| store.get(KEY_ENABLED))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

pub fn set_enabled_flag<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
) -> AppResult<()> {
    let store = open_store(app)?;
    store.set(KEY_ENABLED, serde_json::json!(enabled));
    store.save().map_err(|err| {
        log::error!("failed to persist agent flag: {err}");
        AppError::Internal
    })
}

/// The persisted token, if one was ever provisioned. Never logged.
pub fn stored_token<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    open_store(app)
        .ok()
        .and_then(|store| store.get(KEY_TOKEN))
        .and_then(|value| value.as_str().map(str::to_string))
        .filter(|token| !token.is_empty())
}

/// The existing token, or a freshly generated + persisted one. Distinct from
/// the Collect token by construction — they are different store keys.
pub fn ensure_token<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<String> {
    if let Some(token) = stored_token(app) {
        return Ok(token);
    }
    persist_new_token(app)
}

/// Replace the token (the old one stops working after the server restarts).
pub fn regenerate_token<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<String> {
    persist_new_token(app)
}

fn persist_new_token<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<String> {
    let token = crate::collect::auth::generate_token();
    let store = open_store(app)?;
    store.set(KEY_TOKEN, serde_json::json!(token));
    store.save().map_err(|err| {
        log::error!("failed to persist agent token: {err}");
        AppError::Internal
    })?;
    Ok(token)
}

fn endpoint_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<std::path::PathBuf> {
    let dir = app.path().app_config_dir().map_err(|err| {
        log::error!("no app config dir: {err}");
        AppError::Internal
    })?;
    Ok(dir.join(ENDPOINT_FILE))
}

/// Publish `{port, token}` so the stdio bridge is zero-config and survives the
/// port drifting within the fallback range. Owner-only on Unix. Best-effort:
/// a failure here degrades bridge auto-discovery, not the server.
pub fn write_endpoint_file<R: tauri::Runtime>(app: &tauri::AppHandle<R>, port: u16, token: &str) {
    let Ok(path) = endpoint_path(app) else { return };
    let body = serde_json::json!({
        "app": "yAssets",
        "apiVersion": AGENT_API_VERSION,
        "port": port,
        "token": token,
    });
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(err) = std::fs::write(&path, body.to_string()) {
        log::warn!("could not write the agent endpoint descriptor: {err}");
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

pub fn remove_endpoint_file<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Ok(path) = endpoint_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_and_collect_tokens_live_under_different_keys() {
        // The whole point of the separate surface: revoking one must not touch
        // the other. Guard the key names so a copy-paste can't merge them.
        assert_ne!(KEY_TOKEN, "collect_token");
        assert_ne!(KEY_ENABLED, "collect_enabled");
        assert_eq!(KEY_TOKEN, "agent_token");
        assert_eq!(KEY_ENABLED, "agent_enabled");
    }
}
