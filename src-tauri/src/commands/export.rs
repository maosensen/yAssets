//! Export managed assets back out to a user-chosen directory, restoring the
//! original display name + extension. Name collisions (within the batch or
//! against existing files) get a ` (n)` suffix, Finder-style.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::library::run_blocking;
use crate::state::AppState;

/// Copy `ids` into `dest_dir`. Returns the number of files written.
#[tauri::command]
#[specta::specta]
pub async fn export_assets(
    ids: Vec<String>,
    dest_dir: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<u32> {
    if ids.is_empty() {
        return Ok(0);
    }
    let library = state.current_library()?;
    let dest = PathBuf::from(&dest_dir);
    if !dest.is_dir() {
        return Err(AppError::NotFound(format!(
            "export directory not found: {dest_dir}"
        )));
    }

    // Snapshot (rel_path, name, ext) for the requested ids.
    let rows = {
        let ids = ids.clone();
        library
            .read(move |conn| {
                let placeholders = vec!["?"; ids.len()].join(",");
                let sql = format!(
                    "SELECT rel_path, name, ext FROM assets
                     WHERE deleted_at IS NULL AND id IN ({placeholders})"
                );
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt
                    .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?
    };

    let lib = library.clone();
    run_blocking(move || {
        let mut used: HashSet<String> = HashSet::new();
        let mut written = 0u32;
        for (rel_path, name, ext) in rows {
            let src = lib.resolve_rel(&rel_path);
            let target = unique_path(&dest, &name, &ext, &mut used);
            match std::fs::copy(&src, &target) {
                Ok(_) => written += 1,
                Err(err) => log::warn!("export failed for {}: {err}", src.display()),
            }
        }
        Ok(written)
    })
    .await
}

/// A non-colliding path in `dir` for `<name>.<ext>`, reserving it in `used`.
/// Collisions (batch-local or on-disk) get ` (1)`, ` (2)`, … before the ext.
pub(crate) fn unique_path(
    dir: &Path,
    name: &str,
    ext: &str,
    used: &mut HashSet<String>,
) -> PathBuf {
    let stem = sanitize_filename(name);
    let ext = if ext.is_empty() {
        String::new()
    } else {
        format!(".{ext}")
    };
    for n in 0..10_000 {
        let candidate = if n == 0 {
            format!("{stem}{ext}")
        } else {
            format!("{stem} ({n}){ext}")
        };
        let path = dir.join(&candidate);
        if !used.contains(&candidate) && !path.exists() {
            used.insert(candidate);
            return path;
        }
    }
    // Pathological fallback — extremely unlikely.
    dir.join(format!("{stem}-{}{ext}", crate::library::new_id()))
}

/// Strip path separators and other filesystem-hostile characters from a
/// user-facing name so it's safe as a single filename component.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_path_deduplicates_within_batch() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let mut used = HashSet::new();
        let a = unique_path(tmp.path(), "photo", "png", &mut used);
        let b = unique_path(tmp.path(), "photo", "png", &mut used);
        assert_eq!(a.file_name().unwrap(), "photo.png");
        assert_eq!(b.file_name().unwrap(), "photo (1).png");
    }

    #[test]
    fn unique_path_avoids_existing_files() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        std::fs::write(tmp.path().join("doc.txt"), b"x").expect("seed");
        let mut used = HashSet::new();
        let p = unique_path(tmp.path(), "doc", "txt", &mut used);
        assert_eq!(p.file_name().unwrap(), "doc (1).txt");
    }

    #[test]
    fn sanitize_strips_separators() {
        assert_eq!(sanitize_filename("a/b:c"), "a_b_c");
        assert_eq!(sanitize_filename("  ..  "), "Untitled");
    }

    #[test]
    fn extensionless_names_have_no_dot() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let mut used = HashSet::new();
        let p = unique_path(tmp.path(), "README", "", &mut used);
        assert_eq!(p.file_name().unwrap(), "README");
    }
}
