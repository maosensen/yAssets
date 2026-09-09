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

/// Who asked for this import.
///
/// One input, three consequences — they belong together because they answer
/// the same question, "is anyone watching?": whether exact duplicates are
/// raised in the alert dialog, whether the job announces itself in a toast,
/// and whether files unchanged since their own import are re-read at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum JobOrigin {
    /// A drop, a paste, a folder picker — the user is looking at the app and
    /// waiting for an answer, so every outcome is worth reporting.
    UserInitiated,
    /// A watched folder: the pass at watcher start, or a filesystem event.
    /// Nobody asked for it, so it stays silent unless it actually imported
    /// something, and it trusts a file's own stat over re-hashing it.
    Automatic,
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
    /// Lets the frontend stay quiet for work the user never asked for.
    pub origin: JobOrigin,
}

/// One file that could not be imported, with a user-displayable reason.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ImportFailure {
    /// Source path as given by the user (absolute).
    pub path: String,
    pub reason: String,
}

/// An incoming file whose exact content (blake3) already exists in the
/// library. Powers the interactive Duplicate Alert: "keep both" re-imports
/// `src_path` with dedupe disabled; the existing asset's thumbnail stands in
/// for both sides (identical bytes = identical pixels).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DuplicateItem {
    /// Absolute source path of the incoming file.
    pub src_path: String,
    /// Incoming display name (file stem).
    pub name: String,
    /// Incoming file size in bytes.
    pub size: f64,
    /// Id of the already-cataloged asset with identical content.
    pub existing_id: String,
}

/// A capture arrived through the Collect API (yClip browser extension).
/// The frontend toasts it and refreshes the asset lists — server-side imports
/// bypass the usual frontend mutation, so nothing else would invalidate them.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct CollectImported {
    /// `"link"` (a bookmark) or `"media"` (a downloaded/uploaded file).
    pub kind: String,
    pub title: String,
    /// Already in the library — nothing new to show.
    pub duplicate: bool,
}

/// A write landed through the Agent API (`crate::agent`). Same reason
/// `CollectImported` exists: server-side writes bypass the frontend's mutation
/// layer, so nothing else would invalidate the caches — without this event every
/// open view keeps showing pre-write rows and the user's next edit is based on
/// stale state. Emitted only when something actually changed.
///
/// Carries identifiers, not prose: the toast copy lives in the i18n catalogs.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct AgentMutated {
    /// The tool that ran, e.g. `"tag_assets"`.
    pub tool: String,
    /// Rows changed.
    pub affected: u32,
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
    /// Library-wide exact duplicates skipped this run (empty when the job ran
    /// with dedupe disabled). Batch-internal repeats are not listed.
    pub duplicates: Vec<DuplicateItem>,
    /// True when the job was cancelled before completing.
    pub cancelled: bool,
    /// See `JobOrigin` — an automatic job that imported nothing says nothing.
    pub origin: JobOrigin,
}
