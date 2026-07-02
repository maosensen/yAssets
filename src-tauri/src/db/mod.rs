//! SQLite plumbing: connection setup and versioned migrations.
//!
//! Concurrency model (see `library::Library` for the owning type):
//! - WAL journal → readers and the single writer never block each other
//! - one writer connection guarded by a `Mutex`
//! - a small lazily-grown reader pool (hand-rolled, no r2d2)
//! - every connection applies [`apply_pragmas`] — `foreign_keys` in
//!   particular is per-connection, and forgetting it silently disables
//!   every `ON DELETE CASCADE` in the schema.

pub mod migrations;

use std::path::Path;

use rusqlite::Connection;

use crate::error::AppResult;

/// Per-connection settings. Call on *every* new connection.
pub fn apply_pragmas(conn: &Connection) -> AppResult<()> {
    // journal_mode returns a row; use query_row-style pragma helper.
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |_row| Ok(()))?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

/// Open a connection to the library database file with standard pragmas.
pub fn open_file_connection(db_path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(db_path)?;
    apply_pragmas(&conn)?;
    Ok(conn)
}

/// Best-effort WAL checkpoint so the library folder can be copied/backed up
/// as a whole without a dangling `-wal` sidecar. Called when a library closes.
pub fn checkpoint_truncate(conn: &Connection) {
    if let Err(err) = conn.pragma_update_and_check(None, "wal_checkpoint", "TRUNCATE", |_| Ok(())) {
        log::warn!("wal_checkpoint(TRUNCATE) failed: {err}");
    }
}
