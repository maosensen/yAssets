//! Long-lived application state.
//!
//! Register once at startup with `app.manage(AppState::default())` and inject
//! into commands via `tauri::State<'_, AppState>`. Put connection pools,
//! caches, and other resources that should outlive a single command here —
//! never rebuild them per-invocation.

use std::time::Instant;

pub struct AppState {
    /// When the managed state was initialized; powers the `uptime_ms` demo
    /// command and is a handy place to anchor future long-lived resources.
    pub started_at: Instant,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }
}
