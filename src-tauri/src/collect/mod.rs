//! Local API server — loopback-only HTTP, owner of the listener that hosts two
//! independent surfaces:
//!
//! - **Collect** (this module): what the yClip browser extension talks to
//!   (contract mirror: yClip `lib/contract.ts`).
//! - **Agent** (`crate::agent`): the read-only surface for AI coding agents,
//!   with its own enable flag and its own bearer token.
//!
//! Either surface being enabled keeps the listener up; each gates its own routes
//! per request, so "the server is running" never implies "this surface is on".
//!
//! Architecture: the extension is a thin client; every capture lands in the
//! existing import pipeline (`import_url_core` / `write_and_process`), so
//! dedupe, provenance, thumbnails, and events all behave exactly like ⌘V.
//!
//! Lifecycle: OFF by default. The user enables it in Preferences → Collect,
//! which persists a flag + bearer token in `settings.json` (tauri-plugin-store)
//! and binds the first free port in 41420-41424 on 127.0.0.1. The running
//! server is a `CollectHandle` in `AppState` — dropping it (disable, token
//! regeneration, app exit) signals graceful shutdown, the same RAII pattern
//! as the watch-folder watcher.

pub mod auth;
pub(crate) mod server;

use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub use server::CollectCtx;

/// Preferred port plus fallbacks, in bind order. Mirrored by the extension's
/// discovery probe — change one, change both.
pub const PORTS: [u16; 5] = [41420, 41421, 41422, 41423, 41424];
pub const API_VERSION: u32 = 1;

const STORE_FILE: &str = "settings.json";
const KEY_ENABLED: &str = "collect_enabled";
const KEY_TOKEN: &str = "collect_token";

/// Running server handle. Dropping it triggers graceful shutdown.
pub struct CollectHandle {
    port: u16,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl CollectHandle {
    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for CollectHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
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

/// Whether the user has the Collect API switched on (persisted preference,
/// not whether the server is currently bound — see `AppState::collect_port`).
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
        log::error!("failed to persist collect flag: {err}");
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

/// The existing token, or a freshly generated + persisted one.
fn ensure_token<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<String> {
    if let Some(token) = stored_token(app) {
        return Ok(token);
    }
    persist_new_token(app)
}

/// Replace the token (old one stops working after the next server restart).
pub fn regenerate_token<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<String> {
    persist_new_token(app)
}

fn persist_new_token<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<String> {
    let token = auth::generate_token();
    let store = open_store(app)?;
    store.set(KEY_TOKEN, serde_json::json!(token));
    store.save().map_err(|err| {
        log::error!("failed to persist collect token: {err}");
        AppError::Internal
    })?;
    Ok(token)
}

/// True when either surface wants the listener up.
pub fn any_surface_enabled(app: &tauri::AppHandle) -> bool {
    is_enabled(app) || crate::agent::is_enabled(app)
}

/// Bind the first free port and serve. No-op (returns the port) when already
/// running. The handle lands in `AppState`; errors mean every port was taken.
pub async fn start(app: &tauri::AppHandle) -> AppResult<u16> {
    let state = app.state::<AppState>();
    if let Some(port) = state.collect_port() {
        return Ok(port);
    }
    let token = ensure_token(app)?;
    // Only provision an agent token once the user actually turns that surface
    // on. An absent token authenticates nothing (see `auth::token_matches`).
    let agent_token = if crate::agent::is_enabled(app) {
        crate::agent::ensure_token(app)?
    } else {
        crate::agent::stored_token(app).unwrap_or_default()
    };
    for port in PORTS {
        let listener =
            match tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await {
                Ok(listener) => listener,
                Err(_) => continue,
            };
        let router = server::build_router(
            CollectCtx {
                app: app.clone(),
                token: token.clone(),
                port,
                enabled: is_enabled(app),
            },
            crate::agent::AgentCtx {
                app: app.clone(),
                token: agent_token.clone(),
                enabled: crate::agent::is_enabled(app),
            },
        );
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await
            {
                log::error!("collect server terminated: {err}");
            }
        });
        state.set_collect(Some(CollectHandle {
            port,
            shutdown: Some(tx),
        }));
        if crate::agent::is_enabled(app) {
            crate::agent::write_endpoint_file(app, port, &agent_token);
        }
        log::info!("local API listening on 127.0.0.1:{port}");
        return Ok(port);
    }
    Err(AppError::Conflict(
        "ports 41420-41424 are all in use — close whatever is holding them and retry".into(),
    ))
}

/// Stop the server if running (dropping the handle signals shutdown).
pub fn stop(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    if state.collect_port().is_some() {
        log::info!("local API stopped");
    }
    state.set_collect(None);
    crate::agent::remove_endpoint_file(app);
}

/// Re-apply the persisted flags and tokens to the listener. The router captures
/// its tokens when it spawns, so any change to either surface's flag or token
/// means: drop what is running, then bind again if anyone still wants it. The
/// short sleep lets the old listener release the port so the same one rebinds.
pub async fn reapply(app: &tauri::AppHandle) -> AppResult<()> {
    if app.state::<AppState>().collect_port().is_some() {
        stop(app);
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    if any_surface_enabled(app) {
        start(app).await?;
    }
    Ok(())
}

/// Startup hook: bring the server up if the user left either surface enabled.
pub fn autostart(app: &tauri::AppHandle) {
    if !any_surface_enabled(app) {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = start(&handle).await {
            log::error!("local API autostart failed: {err}");
        }
    });
}
