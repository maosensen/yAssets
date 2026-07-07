//! Long-lived application state.
//!
//! Register once at startup with `app.manage(AppState::default())` and inject
//! into commands via `tauri::State<'_, AppState>`. Put connection pools,
//! caches, and other resources that should outlive a single command here —
//! never rebuild them per-invocation.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use crate::error::{AppError, AppResult};
use crate::library::Library;

pub struct AppState {
    /// The currently open library, if any. Swapped atomically on open/close;
    /// in-flight operations keep the old `Arc` alive until they finish (its
    /// `Drop` checkpoints the WAL).
    ///
    /// Lock discipline: take a short read/write, clone the `Arc`, release —
    /// never hold the guard across an await.
    pub library: RwLock<Option<Arc<Library>>>,
    /// Cancellation flags for in-flight import jobs, keyed by `job_id`.
    /// Entries are added by `import_paths` and removed by the pipeline's
    /// finish path. Library switch/close signals every flag — the pipeline
    /// keeps its own `Arc<Library>`, so late commits still land in the old
    /// (correct) database before it drops.
    imports: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Running watch-folder watcher, if any (see `library::watch`). An opaque
    /// RAII handle — replacing/clearing it drops the previous, stopping its
    /// thread. Reset on every library open/close and after a watched-folder edit.
    watcher: Mutex<Option<Box<dyn std::any::Any + Send>>>,
    /// Shared HTTP client for the Discover feature (third-party source APIs +
    /// full-res downloads). Built once for connection-pool reuse; cloning is
    /// cheap (Arc inside).
    http: reqwest::Client,
}

impl AppState {
    /// The open library, or `NoLibraryOpen` — the standard first line of
    /// every library-scoped command.
    pub fn current_library(&self) -> AppResult<Arc<Library>> {
        self.library
            .read()
            .map_err(|_| {
                log::error!("library slot lock poisoned");
                AppError::Internal
            })?
            .clone()
            .ok_or(AppError::NoLibraryOpen)
    }

    /// Register a new import job; returns its cancellation flag.
    pub fn register_import(&self, job_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut jobs) = self.imports.lock() {
            jobs.insert(job_id.to_string(), Arc::clone(&flag));
        }
        flag
    }

    /// Signal cancellation for one job (no-op if already finished).
    pub fn cancel_import(&self, job_id: &str) {
        if let Ok(jobs) = self.imports.lock() {
            if let Some(flag) = jobs.get(job_id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    /// Signal cancellation for every in-flight job (library switch/close).
    pub fn cancel_all_imports(&self) {
        if let Ok(jobs) = self.imports.lock() {
            for flag in jobs.values() {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    /// Remove a finished job from the registry.
    pub fn finish_import(&self, job_id: &str) {
        if let Ok(mut jobs) = self.imports.lock() {
            jobs.remove(job_id);
        }
    }

    /// Whether any import/rescan job is in flight — orphan cleanup must refuse
    /// while true, since a mid-import file has no DB row yet and would look
    /// orphaned.
    pub fn has_active_imports(&self) -> bool {
        self.imports
            .lock()
            .map(|jobs| !jobs.is_empty())
            .unwrap_or(false)
    }

    /// Install (or clear with `None`) the watch-folder watcher; the previous
    /// handle drops here, stopping its thread.
    pub fn set_watcher(&self, handle: Option<Box<dyn std::any::Any + Send>>) {
        if let Ok(mut slot) = self.watcher.lock() {
            *slot = handle;
        }
    }

    /// A clone of the shared HTTP client (Arc-backed — cheap).
    pub fn http(&self) -> reqwest::Client {
        self.http.clone()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            library: RwLock::new(None),
            imports: Mutex::new(HashMap::new()),
            watcher: Mutex::new(None),
            http: reqwest::Client::builder()
                .user_agent(concat!("yAssets/", env!("CARGO_PKG_VERSION")))
                .timeout(std::time::Duration::from_secs(30))
                // Security: never downgrade to http, and never follow redirects
                // (an image CDN serves the bytes directly). Together with the
                // per-request host check in `commands::sources::download`, this
                // closes the SSRF-via-redirect hole — a 3xx just fails the fetch.
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("failed to build HTTP client"),
        }
    }
}
