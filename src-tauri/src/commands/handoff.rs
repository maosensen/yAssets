//! Staging shared by the OS hand-off paths — drag-out and clipboard copy.
//!
//! Managed files live on disk as `assets/<shard>/<id>.<ext>`, so handing them
//! to another app raw would land `a1b2c3….png` in the target. Both hand-offs
//! first stage each asset under its real `<name>.<ext>` in a temp dir — a hard
//! link (instant, any size) with a copy fallback across volumes — and hand the
//! staged paths over. Leftovers are swept lazily; the OS copies what it needs
//! at drop/paste time, so anything past its window is pure garbage.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::commands::export::unique_path;

/// Stage one managed file under its real `<name>.<ext>` in `dir`, reserving the
/// chosen name in `used`. Returns the staged path, or `None` when the source is
/// missing or can't be materialized (logged, skipped — never fatal to a batch).
pub fn stage_one(
    src: &Path,
    dir: &Path,
    name: &str,
    ext: &str,
    used: &mut HashSet<String>,
) -> Option<PathBuf> {
    if !src.is_file() {
        return None;
    }
    let target = unique_path(dir, name, ext, used);
    // Hard link is instant regardless of size; a copy covers the rare
    // cross-volume temp dir. Skip anything we can't materialize.
    if std::fs::hard_link(src, &target).is_err() && std::fs::copy(src, &target).is_err() {
        log::warn!("stage failed for {}", src.display());
        return None;
    }
    Some(target)
}

/// Best-effort removal of staged files in `dir` older than `stale_secs`.
pub fn sweep_stale(dir: &Path, stale_secs: u64) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(stale_secs);
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
