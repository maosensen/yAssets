//! Library maintenance: on-demand VACUUM, orphan-file cleanup, and an integrity
//! check. Surfaced in Preferences ▸ Maintenance. Heavy work runs on a blocking
//! thread via `run_blocking`; deletes follow the `trash::purge` discipline
//! (best-effort, NotFound-tolerant) and are gated against in-flight imports.

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::library::run_blocking;
use crate::state::AppState;

/// What the Maintenance pane displays before the user acts.
#[derive(Debug, Serialize, specta::Type)]
pub struct MaintenanceReport {
    /// Database file size (excluding WAL), bytes.
    pub db_bytes: f64,
    /// Files under assets/ with no live DB row.
    pub orphan_asset_files: u32,
    /// Thumbnails under thumbs/ with no live DB row.
    pub orphan_thumbnails: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn get_maintenance_report(
    state: tauri::State<'_, AppState>,
) -> AppResult<MaintenanceReport> {
    let library = state.current_library()?;
    run_blocking(move || {
        let (assets, thumbs) = library.find_orphans();
        Ok(MaintenanceReport {
            db_bytes: library.db_size_bytes() as f64,
            orphan_asset_files: assets.len() as u32,
            orphan_thumbnails: thumbs.len() as u32,
        })
    })
    .await
}

/// Reclaim free database pages. Returns bytes reclaimed.
#[tauri::command]
#[specta::specta]
pub async fn vacuum_database(state: tauri::State<'_, AppState>) -> AppResult<f64> {
    let library = state.current_library()?;
    run_blocking(move || library.vacuum().map(|bytes| bytes as f64)).await
}

/// `PRAGMA integrity_check` — true when the database is healthy.
#[tauri::command]
#[specta::specta]
pub async fn verify_integrity(state: tauri::State<'_, AppState>) -> AppResult<bool> {
    let library = state.current_library()?;
    run_blocking(move || library.integrity_check()).await
}

#[derive(Debug, Serialize, specta::Type)]
pub struct OrphanCleanup {
    pub asset_files: u32,
    pub thumbnails: u32,
}

/// Delete orphan asset/thumbnail files (irreversible — no soft delete). Refused
/// while an import is in flight, since a mid-import file has no DB row yet and
/// would be misread as orphaned.
#[tauri::command]
#[specta::specta]
pub async fn clean_orphans(state: tauri::State<'_, AppState>) -> AppResult<OrphanCleanup> {
    if state.has_active_imports() {
        return Err(AppError::Conflict(
            "an import is in progress; try again after it finishes".into(),
        ));
    }
    let library = state.current_library()?;
    run_blocking(move || {
        let (assets, thumbs) = library.find_orphans();
        let remove = |paths: &[std::path::PathBuf]| -> u32 {
            let mut removed = 0;
            for path in paths {
                match std::fs::remove_file(path) {
                    Ok(()) => removed += 1,
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                    Err(err) => log::warn!("failed to delete orphan {}: {err}", path.display()),
                }
            }
            removed
        };
        let asset_files = remove(&assets);
        let thumbnails = remove(&thumbs);
        if asset_files > 0 || thumbnails > 0 {
            log::info!("cleaned {asset_files} orphan file(s), {thumbnails} thumbnail(s)");
        }
        Ok(OrphanCleanup {
            asset_files,
            thumbnails,
        })
    })
    .await
}
