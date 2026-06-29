//! Tauri commands — the typed IPC surface the frontend calls via `invoke`.
//!
//! Conventions:
//! - Fallible commands return [`AppResult<T>`](crate::error::AppResult) so the
//!   frontend receives a structured, code-tagged error.
//! - Long-lived resources are injected via `tauri::State`, never rebuilt here.
//! - Register every command in the `invoke_handler` macro in `lib.rs`.

use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use std::fs;

/// Demo command kept from the scaffold so the index route has something to call.
#[tauri::command]
#[specta::specta]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

/// Milliseconds elapsed since the managed [`AppState`] was created.
///
/// Demonstrates managed-state injection plus the `AppResult` error model
/// (this particular command never fails, but real ones will). Returned as
/// `f64` so it maps to a plain TS `number` — specta refuses to export 64-bit
/// integer types to avoid silent precision loss across the IPC boundary.
#[tauri::command]
#[specta::specta]
pub fn uptime_ms(state: tauri::State<'_, AppState>) -> AppResult<f64> {
    Ok(state.started_at.elapsed().as_secs_f64() * 1000.0)
}

/// A single directory entry returned by [`list_dir`].
#[derive(Debug, Serialize, specta::Type)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// List the immediate children of a directory.
///
/// Realistic starting point for an asset browser: filesystem errors map to a
/// typed [`AppError`](crate::error::AppError) through the `From<std::io::Error>`
/// impl, so the frontend gets `NotFound` vs `Io` rather than an opaque string.
#[tauri::command]
#[specta::specta]
pub fn list_dir(path: String) -> AppResult<Vec<DirEntry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
        });
    }
    Ok(entries)
}
