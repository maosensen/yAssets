//! Import commands: fire-and-forget job start + cancellation.
//!
//! `import_paths` returns a `job_id` immediately; all progress flows through
//! the typed `ImportProgress`/`ImportFinished` events. Paths arrive from the
//! frontend's native drag-drop handler, the file/directory pickers, or the
//! clipboard (`import_clipboard`) — the pipeline is agnostic to the source.

use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::import;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ImportStarted {
    pub job_id: String,
}

/// Start importing `paths` (files and/or directories, absolute) into the
/// current library, optionally attaching every imported asset to `folder_id`.
///
/// `keep_duplicates` disables the library-wide exact-dedupe (the Duplicate
/// Alert's "keep both" path); batch-internal repeats are still collapsed.
#[tauri::command]
#[specta::specta]
pub async fn import_paths(
    paths: Vec<String>,
    folder_id: Option<String>,
    keep_duplicates: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<ImportStarted> {
    if paths.is_empty() {
        return Err(AppError::Conflict("nothing to import".into()));
    }
    let library = state.current_library()?;
    let job_id = import::new_job_id();
    let cancel = state.register_import(&job_id);
    import::spawn(
        app,
        library,
        cancel,
        job_id.clone(),
        paths,
        folder_id,
        keep_duplicates,
        // User-initiated import — surface exact duplicates in the alert dialog.
        true,
    );
    Ok(ImportStarted { job_id })
}

/// Signal cancellation for an in-flight import. Already-committed files stay;
/// the job still emits its terminal `ImportFinished { cancelled: true }`.
#[tauri::command]
#[specta::specta]
pub async fn cancel_import(job_id: String, state: tauri::State<'_, AppState>) -> AppResult<()> {
    state.cancel_import(&job_id);
    Ok(())
}

/// Import whatever the clipboard holds (⌘V): copied files take priority,
/// then a raw bitmap (screenshots, browser "Copy Image") which is written to
/// a temp PNG and fed through the regular pipeline — so hashing/dedupe/
/// thumbnails/events all behave exactly like a file import.
///
/// Returns `Conflict` when the clipboard has nothing importable (the frontend
/// shows a quiet info toast for that code).
#[tauri::command]
#[specta::specta]
pub async fn import_clipboard(
    folder_id: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<ImportStarted> {
    let library = state.current_library()?;
    // Pasteboard access can block on OS IPC — keep it off the async core.
    let paths = tauri::async_runtime::spawn_blocking(clipboard_import_paths)
        .await
        .map_err(|e| {
            log::error!("clipboard task failed: {e}");
            AppError::Internal
        })??;
    let job_id = import::new_job_id();
    let cancel = state.register_import(&job_id);
    import::spawn(
        app,
        library,
        cancel,
        job_id.clone(),
        paths,
        folder_id,
        false,
        // Clipboard paste is user-initiated — surface duplicates in the dialog.
        true,
    );
    Ok(ImportStarted { job_id })
}

/// Resolve the clipboard into importable filesystem paths.
fn clipboard_import_paths() -> AppResult<Vec<String>> {
    use clipboard_rs::common::RustImage;
    use clipboard_rs::{Clipboard, ClipboardContext};

    let ctx = ClipboardContext::new().map_err(|e| {
        log::error!("clipboard unavailable: {e}");
        AppError::Internal
    })?;

    // 1) Copied files (arrive as file:// URIs on macOS).
    if let Ok(files) = ctx.get_files() {
        let paths: Vec<String> = files
            .iter()
            .filter_map(|entry| normalize_file_uri(entry))
            .collect();
        if !paths.is_empty() {
            return Ok(paths);
        }
    }

    // 2) Raw bitmap → temp PNG. Content-hash dedupe still applies downstream,
    //    so pasting the same image twice imports once.
    if let Ok(image) = ctx.get_image() {
        if !image.is_empty() {
            let png = image.to_png().map_err(|e| {
                log::error!("clipboard image decode failed: {e}");
                AppError::Internal
            })?;
            let dir = std::env::temp_dir().join("yassets-paste");
            std::fs::create_dir_all(&dir)?;
            sweep_stale_pastes(&dir);
            let file = dir.join(format!(
                "Pasted image {}.png",
                &crate::library::new_id()[..6]
            ));
            std::fs::write(&file, png.get_bytes())?;
            return Ok(vec![file.to_string_lossy().into_owned()]);
        }
    }

    Err(AppError::Conflict(
        "clipboard has no importable content".into(),
    ))
}

/// `file:///Users/a%20b/x.png` → `/Users/a b/x.png`; plain paths pass through.
fn normalize_file_uri(value: &str) -> Option<String> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let Some(rest) = raw.strip_prefix("file://") else {
        return Some(raw.to_string());
    };
    // Drop an optional host component (file://localhost/…).
    let path = rest.strip_prefix("localhost").unwrap_or(rest);
    let decoded = percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .ok()?;
    if decoded.is_empty() {
        None
    } else {
        Some(decoded.into_owned())
    }
}

/// Best-effort cleanup of paste temp files older than an hour. The import
/// pipeline copies into the library immediately, so these are pure leftovers.
fn sweep_stale_pastes(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .map(|modified| modified < cutoff)
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_file_uri;

    #[test]
    fn file_uris_are_decoded() {
        assert_eq!(
            normalize_file_uri("file:///Users/a%20b/x.png").as_deref(),
            Some("/Users/a b/x.png")
        );
        assert_eq!(
            normalize_file_uri("file://localhost/tmp/y.png").as_deref(),
            Some("/tmp/y.png")
        );
    }

    #[test]
    fn plain_paths_pass_through() {
        assert_eq!(
            normalize_file_uri("/tmp/plain.png").as_deref(),
            Some("/tmp/plain.png")
        );
        assert_eq!(normalize_file_uri("   "), None);
    }
}
