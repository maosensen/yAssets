//! Live watch-folder auto-import.
//!
//! A debounced `notify` watcher over the library's enabled `watched_folders`
//! rows. New/changed files import into the row's target folder through the
//! normal pipeline (content-hash dedupe makes a re-fire on an unchanged file a
//! no-op, so a modify event never re-imports the same bytes). The watcher never
//! observes the app's own writes — `add_watched_folder` forbids watching inside
//! (or a parent of) the library root, and imports copy into the library, not the
//! watched folder.
//!
//! Lifecycle: started in `commands::library::install_library` and stored in
//! `AppState` as an opaque RAII handle; dropping it (library switch/close, or a
//! restart after a CRUD change) stops the watch thread.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use notify_debouncer_full::new_debouncer;
use notify_debouncer_full::notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{DebounceEventResult, DebouncedEvent};
use tauri::Manager;

use crate::library::Library;
use crate::state::AppState;

/// Opaque RAII handle for the running watcher — dropping it stops the thread.
pub type WatchHandle = Box<dyn std::any::Any + Send>;

/// Coalesce the event storm from a large copy / write-then-rename before import.
const DEBOUNCE_MS: u64 = 700;

/// (watched root, target library folder id) for each enabled row.
type Targets = Vec<(PathBuf, Option<String>)>;

/// Start watching the library's enabled folders. Returns None when there are
/// none or the watcher can't be built (both logged, never fatal).
pub fn start(app: tauri::AppHandle, library: Arc<Library>) -> Option<WatchHandle> {
    let targets: Targets = library
        .with_reader(|conn| {
            let mut stmt =
                conn.prepare("SELECT path, folder_id FROM watched_folders WHERE auto_import = 1")?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        PathBuf::from(row.get::<_, String>(0)?),
                        row.get::<_, Option<String>>(1)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .unwrap_or_default();
    if targets.is_empty() {
        return None;
    }

    // Reconcile files added while the app was closed: one import pass over each
    // watched root now. Dedupe skips already-cataloged files and nested
    // structure mirrors via the normal pipeline; live events handle the rest.
    reconcile(&app, &library, &targets);

    // Live watcher owns its own clones so `app`/`library` stay available above.
    let handler_targets = targets.clone();
    let cb_app = app.clone();
    let cb_library = Arc::clone(&library);
    let mut debouncer = match new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: DebounceEventResult| match result {
            Ok(events) => on_events(&cb_app, &cb_library, &handler_targets, events),
            Err(errors) => {
                for err in errors {
                    log::warn!("watch error: {err}");
                }
            }
        },
    ) {
        Ok(debouncer) => debouncer,
        Err(err) => {
            log::error!("failed to start folder watcher: {err}");
            return None;
        }
    };

    let mut watched_any = false;
    for (root, _) in &targets {
        match debouncer.watcher().watch(root, RecursiveMode::Recursive) {
            Ok(()) => {
                // Keep the debouncer's file-id cache in sync for this root.
                debouncer.cache().add_root(root, RecursiveMode::Recursive);
                watched_any = true;
            }
            Err(err) => log::warn!("cannot watch {}: {err}", root.display()),
        }
    }
    if !watched_any {
        return None;
    }
    log::info!("watching {} folder(s) for auto-import", targets.len());
    Some(Box::new(debouncer))
}

/// Stop any running watcher and start a fresh one from the current rows — call
/// after a watched-folder CRUD change so it takes effect without reopening.
pub fn restart(app: &tauri::AppHandle, state: &AppState, library: &Arc<Library>) {
    state.set_watcher(start(app.clone(), Arc::clone(library)));
}

/// Import each watched root once (dedupe-safe) to catch files added while the
/// app wasn't running. Runs at watcher start.
fn reconcile(app: &tauri::AppHandle, library: &Arc<Library>, targets: &Targets) {
    let state = app.state::<AppState>();
    for (root, folder_id) in targets {
        if !root.is_dir() {
            continue;
        }
        let job_id = crate::import::new_job_id();
        let cancel = state.register_import(&job_id);
        crate::import::spawn(
            app.clone(),
            Arc::clone(library),
            cancel,
            job_id,
            vec![root.to_string_lossy().into_owned()],
            folder_id.clone(),
            false,
        );
    }
}

/// A debounced batch: import new/changed files, grouped by their watched
/// folder's target so each group lands in the right place.
fn on_events(
    app: &tauri::AppHandle,
    library: &Arc<Library>,
    targets: &Targets,
    events: Vec<DebouncedEvent>,
) {
    let mut by_target: HashMap<Option<String>, Vec<String>> = HashMap::new();
    for event in events {
        if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
            continue;
        }
        for path in &event.paths {
            if !path.is_file() {
                continue; // dirs, and racing deletes, are skipped
            }
            // The most-specific watched root that contains this path wins, so a
            // watched folder nested under another gets its own target.
            let folder_id = targets
                .iter()
                .filter(|(root, _)| path.starts_with(root))
                .max_by_key(|(root, _)| root.as_os_str().len())
                .map(|(_, folder)| folder.clone());
            if let Some(folder_id) = folder_id {
                by_target
                    .entry(folder_id)
                    .or_default()
                    .push(path.to_string_lossy().into_owned());
            }
        }
    }
    if by_target.is_empty() {
        return;
    }

    let state = app.state::<AppState>();
    for (folder_id, paths) in by_target {
        let job_id = crate::import::new_job_id();
        let cancel = state.register_import(&job_id);
        crate::import::spawn(
            app.clone(),
            Arc::clone(library),
            cancel,
            job_id,
            paths,
            folder_id,
            false,
        );
    }
}
