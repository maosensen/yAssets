//! Import commands: fire-and-forget job start + cancellation.
//!
//! `import_paths` returns a `job_id` immediately; all progress flows through
//! the typed `ImportProgress`/`ImportFinished` events. Paths arrive from the
//! frontend's native drag-drop handler or the file/directory pickers — the
//! command is agnostic to the source.

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
#[tauri::command]
#[specta::specta]
pub async fn import_paths(
    paths: Vec<String>,
    folder_id: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<ImportStarted> {
    if paths.is_empty() {
        return Err(AppError::Conflict("nothing to import".into()));
    }
    let library = state.current_library()?;
    let job_id = import::new_job_id();
    let cancel = state.register_import(&job_id);
    import::spawn(app, library, cancel, job_id.clone(), paths, folder_id);
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
