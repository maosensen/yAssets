//! Application-wide error type that crosses the IPC boundary.
//!
//! Serialized as `{ "code": <variant>, "detail": <payload> }` (see the
//! `serde(tag/content)` attributes) so the frontend can branch on a stable
//! `code` for UI/retry decisions while `detail` carries a human-readable
//! message for display and logging. Keep the mirror in `src/lib/errors.ts`
//! aligned with these variants.

use serde::Serialize;

// `Db`/`Internal` are part of the IPC error contract (mirrored in errors.ts)
// but not yet constructed by any command — keep them as the stable surface.
#[allow(dead_code)]
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "code", content = "detail")]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("database error: {0}")]
    Db(String),
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
