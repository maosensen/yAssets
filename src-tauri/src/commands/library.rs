//! Library lifecycle commands: create / open / close / current / recent / stats.
//!
//! Pattern shared by all library-scoped commands in this codebase:
//! `async fn` → snapshot `Arc<Library>` from state under a short lock →
//! heavy work (filesystem, SQLite) on a blocking thread via
//! `library::run_blocking` / `Library::read` / `Library::write`.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::library::recent::{self, RecentLibrary};
use crate::library::{run_blocking, Library, LibraryInfo};
use crate::state::AppState;

/// Create a new library folder at `path`, open it, and make it current.
#[tauri::command]
#[specta::specta]
pub async fn create_library(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<LibraryInfo> {
    let root = PathBuf::from(&path);
    let library = run_blocking(move || Library::create(&root)).await?;
    install_library(&app, &state, library)
}

/// Open an existing library at `path` (migrating forward if needed) and make
/// it current.
#[tauri::command]
#[specta::specta]
pub async fn open_library(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<LibraryInfo> {
    let root = PathBuf::from(&path);
    let library = run_blocking(move || Library::open(&root)).await?;
    install_library(&app, &state, library)
}

/// Swap the freshly constructed library into state, record it as recent and
/// as the auto-reopen target, and kick off the background orphan sweep. The
/// previous library's `Arc` drops (checkpointing its WAL) once in-flight
/// operations release it.
fn install_library(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    library: Library,
) -> AppResult<LibraryInfo> {
    // In-flight imports hold their own Arc to the *old* library — signal them
    // to wind down; their remaining commits still land in the old database.
    state.cancel_all_imports();
    // Stop the previous library's watch-folder watcher before swapping.
    state.set_watcher(None);
    let library = Arc::new(library);
    let info = library.info();
    *state.library.write().map_err(|_| AppError::Internal)? = Some(Arc::clone(&library));
    recent::remember(app, &info)?;
    recent::set_last_library(app, Some(&info.path))?;
    // Start auto-import watching for this library's enabled watched folders.
    state.set_watcher(crate::library::watch::start(
        app.clone(),
        Arc::clone(&library),
    ));
    crate::library::spawn_orphan_sweep(Arc::clone(&library));
    crate::library::spawn_backfill(library);
    Ok(info)
}

/// Reopen the library from the previous session, if it is still there.
/// Called by the route guard on startup — failures degrade to the welcome
/// screen (and clear the stale pointer), never a blocked launch.
#[tauri::command]
#[specta::specta]
pub async fn reopen_last_library(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<Option<LibraryInfo>> {
    // Idempotent: if something is already open, report it.
    if let Ok(current) = state.current_library() {
        return Ok(Some(current.info()));
    }
    let Some(path) = recent::last_library(&app) else {
        return Ok(None);
    };
    let root = PathBuf::from(&path);
    match run_blocking(move || Library::open(&root)).await {
        Ok(library) => install_library(&app, &state, library).map(Some),
        Err(err) => {
            log::warn!("could not reopen last library {path}: {err}");
            recent::set_last_library(&app, None)?;
            Ok(None)
        }
    }
}

/// Close the current library (welcome screen / library switcher). No-op when
/// nothing is open.
#[tauri::command]
#[specta::specta]
pub async fn close_library(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    state.cancel_all_imports();
    state.set_watcher(None);
    // Explicit close = don't auto-reopen next launch.
    recent::set_last_library(&app, None)?;
    let previous = state
        .library
        .write()
        .map_err(|_| AppError::Internal)?
        .take();
    // Drop outside the lock; usually the last ref, so WAL checkpoints here.
    drop(previous);
    Ok(())
}

/// The library the app currently has open, if any — the router guard's
/// source of truth.
#[tauri::command]
#[specta::specta]
pub async fn get_current_library(
    state: tauri::State<'_, AppState>,
) -> AppResult<Option<LibraryInfo>> {
    Ok(state
        .library
        .read()
        .map_err(|_| AppError::Internal)?
        .as_ref()
        .map(|library| library.info()))
}

/// Recently opened libraries, most recent first, with a `missing` flag for
/// folders that have moved or been deleted.
#[tauri::command]
#[specta::specta]
pub async fn list_recent_libraries(app: tauri::AppHandle) -> AppResult<Vec<RecentLibrary>> {
    recent::list(&app)
}

/// Remove one entry from the recent list (does not touch the folder).
#[tauri::command]
#[specta::specta]
pub async fn remove_recent_library(path: String, app: tauri::AppHandle) -> AppResult<()> {
    recent::remove(&app, &path)
}

/// Counters for the sidebar badges and the folder-summary panel.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct LibraryStats {
    /// Alive (non-trashed) assets.
    pub total: u32,
    /// Alive assets that belong to no folder.
    pub uncategorized: u32,
    /// Alive assets carrying no tag.
    pub untagged: u32,
    /// Trashed assets.
    pub trash: u32,
    /// Total size of alive assets, in bytes.
    pub total_size: f64,
}

/// One aggregate query over `assets` — cheap enough to refetch after any
/// mutation that could move the counters.
#[tauri::command]
#[specta::specta]
pub async fn get_library_stats(state: tauri::State<'_, AppState>) -> AppResult<LibraryStats> {
    let library = state.current_library()?;
    library
        .read(|conn| {
            let stats = conn.query_row(
                "SELECT
                   COUNT(*) FILTER (WHERE deleted_at IS NULL),
                   COUNT(*) FILTER (WHERE deleted_at IS NULL AND NOT EXISTS (
                     SELECT 1 FROM asset_folders af WHERE af.asset_id = assets.id
                   )),
                   COUNT(*) FILTER (WHERE deleted_at IS NULL AND NOT EXISTS (
                     SELECT 1 FROM asset_tags at WHERE at.asset_id = assets.id
                   )),
                   COUNT(*) FILTER (WHERE deleted_at IS NOT NULL),
                   COALESCE(SUM(size) FILTER (WHERE deleted_at IS NULL), 0)
                 FROM assets",
                [],
                |row| {
                    Ok(LibraryStats {
                        total: row.get::<_, i64>(0)? as u32,
                        uncategorized: row.get::<_, i64>(1)? as u32,
                        untagged: row.get::<_, i64>(2)? as u32,
                        trash: row.get::<_, i64>(3)? as u32,
                        total_size: row.get::<_, i64>(4)? as f64,
                    })
                },
            )?;
            Ok(stats)
        })
        .await
}
