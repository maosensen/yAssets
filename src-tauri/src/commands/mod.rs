//! Tauri commands — the typed IPC surface the frontend calls.
//!
//! Conventions:
//! - Fallible commands return [`AppResult<T>`](crate::error::AppResult) so the
//!   frontend receives a structured, code-tagged error.
//! - Library-scoped commands are `async fn`: snapshot `Arc<Library>` from
//!   managed state under a short lock, then do the work on a blocking thread
//!   via `Library::read`/`Library::write`/`library::run_blocking`.
//! - Register every command in `specta_builder()`'s `collect_commands![]`
//!   (lib.rs) — that single list drives both the runtime handler and the
//!   generated TypeScript bindings.
//! - One file per domain.

pub mod assets;
pub mod clipboard;
pub mod collect;
pub mod drag;
pub mod duplicates;
pub mod export;
pub mod folders;
pub mod handoff;
pub mod import;
pub mod library;
pub mod maintenance;
pub mod smart_folders;
pub mod sources;
pub mod tags;
pub mod trash;
pub mod url;
pub mod watched_folders;
