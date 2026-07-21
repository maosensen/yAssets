//! Copy managed files onto the OS clipboard (⌘C) so they paste into another
//! application — Finder, a browser, a chat box.
//!
//! The mirror of `import_clipboard` (⌘V, which reads files off the clipboard).
//! Like the drag-out path it stages each asset under its real `<name>.<ext>`
//! (see `handoff`) before handing the paths over, so the paste lands
//! `photo.png`, not `a1b2c3….png`. Paths are resolved here in Rust and never
//! cross the IPC boundary (see `reveal_asset`).

use std::collections::HashSet;

use crate::commands::handoff;
use crate::error::{AppError, AppResult};
use crate::library::run_blocking;
use crate::state::AppState;

/// Staged clipboard files outlive a drag by a wide margin — the user may copy,
/// switch apps, and paste minutes later — so they get the same hour-long window
/// as pasted-image temps rather than the drag path's seconds.
const STALE_SECS: u64 = 3600;

/// Copy `ids` onto the OS clipboard as files. Returns once the clipboard holds
/// the staged paths; pasting into another app then copies the real files out.
#[tauri::command]
#[specta::specta]
pub async fn copy_assets_to_clipboard(
    ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    if ids.is_empty() {
        return Err(AppError::Conflict("nothing to copy".into()));
    }
    let library = state.current_library()?;

    // (rel_path, name, ext) for the alive requested assets.
    let rows = {
        let ids = ids.clone();
        library
            .read(move |conn| {
                let placeholders = vec!["?"; ids.len()].join(",");
                let sql = format!(
                    "SELECT rel_path, name, ext FROM assets
                     WHERE deleted_at IS NULL AND id IN ({placeholders})"
                );
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt
                    .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?
    };
    if rows.is_empty() {
        return Err(AppError::NotFound("no copyable assets".into()));
    }

    // Stage real-named links/copies and write them to the clipboard off the
    // async core — pasteboard access blocks on OS IPC, like the ⌘V read path.
    let lib = library.clone();
    run_blocking(move || {
        let dir = std::env::temp_dir().join("yassets-copy");
        std::fs::create_dir_all(&dir)?;
        handoff::sweep_stale(&dir, STALE_SECS);

        let mut used: HashSet<String> = HashSet::new();
        let mut paths: Vec<String> = Vec::new();
        for (rel_path, name, ext) in &rows {
            let src = lib.resolve_rel(rel_path);
            if let Some(target) = handoff::stage_one(&src, &dir, name, ext, &mut used) {
                paths.push(target.to_string_lossy().into_owned());
            }
        }
        if paths.is_empty() {
            return Err(AppError::NotFound("no copyable files".into()));
        }

        set_clipboard_files(paths)
    })
    .await
}

/// Write filesystem paths onto the OS clipboard as a file selection.
fn set_clipboard_files(paths: Vec<String>) -> AppResult<()> {
    use clipboard_rs::{Clipboard, ClipboardContext};

    let ctx = ClipboardContext::new().map_err(|e| {
        log::error!("clipboard unavailable: {e}");
        AppError::Internal
    })?;
    ctx.set_files(paths).map_err(|e| {
        log::error!("clipboard set_files failed: {e}");
        AppError::Io("failed to copy files to clipboard".into())
    })?;
    Ok(())
}
