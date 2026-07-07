//! Application-wide error type that crosses the IPC boundary.
//!
//! Serialized as `{ "code": <variant>, "detail": <payload> }` (see the
//! `serde(tag/content)` attributes) so the frontend can branch on a stable
//! `code` for UI/retry decisions while `detail` carries a human-readable
//! message for display and logging. Keep the mirror in `src/lib/errors.ts`
//! aligned with these variants.

use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize, specta::Type)]
#[serde(tag = "code", content = "detail")]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("database error: {0}")]
    Db(String),
    /// A command that requires an open library was called without one.
    #[error("no library open")]
    NoLibraryOpen,
    /// The folder is not a yAssets library, is damaged, or was written by a
    /// newer app version (schema ahead of this build's migrations).
    #[error("library incompatible: {0}")]
    LibraryIncompatible(String),
    /// The operation conflicts with current state (target not empty, folder
    /// cycle, import in flight while switching libraries, …).
    #[error("conflict: {0}")]
    Conflict(String),
    /// A third-party source request failed (offline, timeout, bad response).
    #[error("network error: {0}")]
    Network(String),
    /// User-visible catch-all. Internal details belong in the logs, not here.
    #[error("internal error")]
    Internal,
}

/// Convenience alias for command return types.
pub type AppResult<T> = Result<T, AppError>;

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound(err.to_string()),
            _ => AppError::Io(err.to_string()),
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        // Full detail goes to the log; the IPC payload carries a displayable
        // summary (the frontend maps codes to localized copy anyway).
        log::error!("database error: {err}");
        AppError::Db(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        log::error!("json (de)serialization error: {err}");
        AppError::LibraryIncompatible(format!("invalid library metadata: {err}"))
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        // Strip the URL FIRST: on a non-2xx status reqwest attaches the full
        // request URL to the error, and source APIs carry the API key in the
        // query string (`?key=…` / `apikey=…`). Without this, the secret would
        // land in both the log file and the IPC error payload. `without_url`
        // clears it while keeping the useful kind (status/timeout/etc.).
        let err = err.without_url();
        // Network failures are expected (offline, timeouts) — warn, don't error.
        log::warn!("network error: {err}");
        AppError::Network(err.to_string())
    }
}
