//! Typed events emitted from Rust to the frontend.
//!
//! Every event derives `tauri_specta::Event` and is registered in
//! `collect_events![]` inside `specta_builder()` (lib.rs), which both mounts
//! the runtime plumbing (`mount_events`) and exports typed `events.*` helpers
//! into `src/lib/bindings.ts` — same drift protection as commands.
//!
//! Emit with `SomeEvent { .. }.emit(&app_handle)` (via the `tauri_specta::Event`
//! trait). Progress events are throttled at the call site (every ≥80 ms or 20
//! items) so the IPC channel is never flooded.

use serde::{Deserialize, Serialize};

/// Which stage of the import pipeline a progress event refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum ImportPhase {
    /// Walking the dropped paths, expanding directories into a file list.
    /// `total` grows while discovering.
    Discovering,
    /// Hashing / copying / thumbnailing / inserting files. `total` is final.
    Processing,
}

/// Throttled progress snapshot for an in-flight import job.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ImportProgress {
    pub job_id: String,
    pub phase: ImportPhase,
    /// Files fully processed so far (imported + skipped + failed).
    pub done: u32,
    /// Total files discovered for this job (grows during `Discovering`).
    pub total: u32,
    /// Display name of the file currently being processed, if any.
    pub current: Option<String>,
    /// Files that failed so far.
    pub failed: u32,
}

/// One file that could not be imported, with a user-displayable reason.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ImportFailure {
    /// Source path as given by the user (absolute).
    pub path: String,
    pub reason: String,
}

/// Terminal event for an import job — exactly one per `job_id`, even on cancel.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ImportFinished {
    pub job_id: String,
    /// Newly inserted assets.
    pub imported: u32,
    /// Duplicates (same blake3 hash) that were skipped.
    pub skipped: u32,
    pub failed: Vec<ImportFailure>,
    /// True when the job was cancelled before completing.
    pub cancelled: bool,
}
