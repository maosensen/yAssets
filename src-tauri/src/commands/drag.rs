//! Native OS drag-out — hand managed files to another application.
//!
//! The grid's in-app drag (folder / trash) is a DOM ghost that can't cross the
//! window edge; once the pointer leaves the window the frontend hands off here.
//! We start a real OS drag session (`drag` crate, the same call
//! `tauri-plugin-drag` makes) so the files land in Finder, a browser, or a chat
//! box.
//!
//! Two details matter:
//! - **Filenames.** Managed files live on disk as `assets/<shard>/<id>.<ext>`,
//!   so dragging them raw would drop `a1b2c3….png` into the target app. We first
//!   stage each asset under its real `<name>.<ext>` in a temp dir — a hard link
//!   (instant, any size) with a copy fallback across volumes — and drag those.
//! - **Main thread.** macOS `beginDraggingSession` must run on the main thread,
//!   so the `start_drag` call is dispatched via `run_on_main_thread`. Paths are
//!   resolved here in Rust and never cross the IPC boundary (see `reveal_asset`).

use std::collections::HashSet;
use std::path::PathBuf;

use tauri::{Manager, WebviewWindow};

use crate::commands::handoff;
use crate::error::{AppError, AppResult};
use crate::library::run_blocking;
use crate::state::AppState;

/// Staged drag files older than this are swept at the next drag — a drag
/// session that outlives it has long since been read by the drop target.
const STALE_SECS: u64 = 60;

/// Begin an OS drag of `ids` out of the window. Returns once the drag session
/// has started (the OS then owns the gesture); the drop target is external.
#[tauri::command]
#[specta::specta]
pub async fn start_asset_drag(
    ids: Vec<String>,
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    if ids.is_empty() {
        return Err(AppError::Conflict("nothing to drag".into()));
    }
    let library = state.current_library()?;

    // (id, rel_path, name, ext) for the alive requested assets.
    let rows = {
        let ids = ids.clone();
        library
            .read(move |conn| {
                let placeholders = vec!["?"; ids.len()].join(",");
                let sql = format!(
                    "SELECT id, rel_path, name, ext FROM assets
                     WHERE deleted_at IS NULL AND id IN ({placeholders})"
                );
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt
                    .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?
    };
    if rows.is_empty() {
        return Err(AppError::NotFound("no draggable assets".into()));
    }

    // Stage real-named links/copies + pick a drag image, off the async core.
    let lib = library.clone();
    let staged = run_blocking(move || {
        let dir = std::env::temp_dir().join("yassets-drag");
        std::fs::create_dir_all(&dir)?;
        handoff::sweep_stale(&dir, STALE_SECS);

        let mut used: HashSet<String> = HashSet::new();
        let mut paths: Vec<PathBuf> = Vec::new();
        let mut image: Option<PathBuf> = None;
        for (id, rel_path, name, ext) in &rows {
            let src = lib.resolve_rel(rel_path);
            let Some(target) = handoff::stage_one(&src, &dir, name, ext, &mut used) else {
                continue;
            };
            if image.is_none() {
                let thumb = lib.thumb_path(id);
                image = Some(if thumb.is_file() {
                    thumb
                } else {
                    target.clone()
                });
            }
            paths.push(target);
        }
        Ok::<_, AppError>(Staged { paths, image })
    })
    .await?;

    if staged.paths.is_empty() {
        return Err(AppError::NotFound("no draggable files".into()));
    }
    let image = drag::Image::File(staged.image.unwrap_or_else(|| staged.paths[0].clone()));

    // macOS requires the drag session to start on the main thread. Bridge the
    // start result back so a failure surfaces to the caller. `start_drag` takes
    // the native window: a Tauri `WebviewWindow` (via raw-window-handle) on
    // macOS/Windows, but a `gtk::ApplicationWindow` on Linux — split per the
    // `drag` crate's platform-divergent signature, mirroring tauri-plugin-drag.
    let app = window.app_handle().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let item = drag::DragItem::Files(staged.paths);
        let options = drag::Options::default();
        let on_drop = move |_result, _cursor| {};
        let result = {
            #[cfg(target_os = "linux")]
            {
                match window.gtk_window() {
                    Ok(gtk_window) => drag::start_drag(&gtk_window, item, image, on_drop, options)
                        .map_err(|err| err.to_string()),
                    Err(err) => Err(format!("gtk window unavailable: {err}")),
                }
            }
            #[cfg(not(target_os = "linux"))]
            {
                drag::start_drag(&window, item, image, on_drop, options)
                    .map_err(|err| err.to_string())
            }
        };
        let _ = tx.send(result);
    })
    .map_err(|err| {
        log::error!("drag dispatch to main thread failed: {err}");
        AppError::Internal
    })?;

    match rx.recv() {
        Ok(Ok(())) => Ok(()),
        Ok(Err(err)) => {
            log::error!("start_drag failed: {err}");
            Err(AppError::Io("failed to start drag".into()))
        }
        Err(_) => Err(AppError::Internal),
    }
}

/// Staged drag payload: the temp files to drag + the drag image to show.
struct Staged {
    paths: Vec<PathBuf>,
    image: Option<PathBuf>,
}
