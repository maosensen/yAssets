//! Trash commands. Soft-delete semantics per the plan:
//!
//! - Trashing sets `deleted_at`; files stay in place, folder memberships
//!   stay — restore is O(1) and lands assets back in their folders.
//! - Permanent deletion removes DB rows FIRST (atomic transaction), then the
//!   files. A crash in between leaves id-named orphan files with no rows —
//!   invisible and harmless (log-only sweep in M6). The reverse order could
//!   leave live rows pointing at missing files, which is user-visible.

use serde::Serialize;

use crate::error::AppResult;
use crate::library::now_ms;
use crate::state::AppState;

fn placeholders(n: usize) -> String {
    vec!["?"; n].join(",")
}

#[tauri::command]
#[specta::specta]
pub async fn trash_assets(ids: Vec<String>, state: tauri::State<'_, AppState>) -> AppResult<u32> {
    if ids.is_empty() {
        return Ok(0);
    }
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let sql = format!(
                "UPDATE assets SET deleted_at = ?1, updated_at = ?1
                 WHERE deleted_at IS NULL AND id IN ({})",
                placeholders(ids.len())
            );
            let mut params: Vec<rusqlite::types::Value> =
                vec![rusqlite::types::Value::Integer(now_ms())];
            params.extend(
                ids.iter()
                    .map(|id| rusqlite::types::Value::Text(id.clone())),
            );
            let changed = conn.execute(&sql, rusqlite::params_from_iter(params.iter()))?;
            Ok(changed as u32)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn restore_assets(ids: Vec<String>, state: tauri::State<'_, AppState>) -> AppResult<u32> {
    if ids.is_empty() {
        return Ok(0);
    }
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let sql = format!(
                "UPDATE assets SET deleted_at = NULL, updated_at = ?1
                 WHERE deleted_at IS NOT NULL AND id IN ({})",
                placeholders(ids.len())
            );
            let mut params: Vec<rusqlite::types::Value> =
                vec![rusqlite::types::Value::Integer(now_ms())];
            params.extend(
                ids.iter()
                    .map(|id| rusqlite::types::Value::Text(id.clone())),
            );
            let changed = conn.execute(&sql, rusqlite::params_from_iter(params.iter()))?;
            Ok(changed as u32)
        })
        .await
}

/// Rows to physically remove: id + rel_path snapshot.
#[derive(Debug, Clone, Serialize)]
struct Doomed {
    id: String,
    rel_path: String,
}

/// Shared tail of `delete_assets_forever` / `empty_trash`: delete the rows in
/// one transaction, then best-effort remove the files (see module docs for
/// the ordering rationale).
async fn purge(
    library: std::sync::Arc<crate::library::Library>,
    where_clause: String,
    ids: Vec<String>,
) -> AppResult<u32> {
    let lib_for_files = library.clone();
    let doomed = library
        .write(move |conn| {
            let select = format!(
                "SELECT id, rel_path FROM assets WHERE deleted_at IS NOT NULL {where_clause}"
            );
            let tx = conn.transaction()?;
            let rows = {
                let mut stmt = tx.prepare(&select)?;
                let collected = stmt
                    .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
                        Ok(Doomed {
                            id: row.get(0)?,
                            rel_path: row.get(1)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                collected
            };
            if !rows.is_empty() {
                let delete = format!(
                    "DELETE FROM assets WHERE id IN ({})",
                    placeholders(rows.len())
                );
                tx.execute(
                    &delete,
                    rusqlite::params_from_iter(rows.iter().map(|d| d.id.as_str())),
                )?;
            }
            tx.commit()?;
            Ok(rows)
        })
        .await?;

    let removed = doomed.len() as u32;
    // Files after rows — outside any lock; failures degrade to orphan files.
    crate::library::run_blocking(move || {
        for entry in &doomed {
            let file = lib_for_files.resolve_rel(&entry.rel_path);
            if let Err(err) = std::fs::remove_file(&file) {
                if err.kind() != std::io::ErrorKind::NotFound {
                    log::warn!("failed to remove {}: {err}", file.display());
                }
            }
            let thumb = lib_for_files.thumb_path(&entry.id);
            if let Err(err) = std::fs::remove_file(&thumb) {
                if err.kind() != std::io::ErrorKind::NotFound {
                    log::warn!("failed to remove {}: {err}", thumb.display());
                }
            }
        }
        Ok(())
    })
    .await?;

    Ok(removed)
}

/// Permanently delete specific trashed assets (rows first, then files).
/// Ids that are not in the trash are ignored.
#[tauri::command]
#[specta::specta]
pub async fn delete_assets_forever(
    ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<u32> {
    if ids.is_empty() {
        return Ok(0);
    }
    let library = state.current_library()?;
    let clause = format!("AND id IN ({})", placeholders(ids.len()));
    purge(library, clause, ids).await
}

/// Permanently delete everything in the trash.
#[tauri::command]
#[specta::specta]
pub async fn empty_trash(state: tauri::State<'_, AppState>) -> AppResult<u32> {
    let library = state.current_library()?;
    purge(library, String::new(), Vec::new()).await
}

#[cfg(test)]
mod tests {
    use crate::error::AppError;
    use crate::library::Library;
    use std::collections::HashSet;
    use std::sync::Mutex;

    fn lib_with_imported_asset() -> (tempfile::TempDir, Library, String) {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let lib = Library::create(&tmp.path().join("Lib")).expect("create");
        let src = tmp.path().join("pic.png");
        let img = image::RgbaImage::from_pixel(64, 48, image::Rgba([1, 2, 3, 255]));
        img.save(&src).expect("fixture");
        let seen = Mutex::new(HashSet::new());
        crate::import::process_file(&lib, &src, None, &seen, false).expect("import");
        let id: String = lib
            .with_reader(|conn| {
                Ok(conn
                    .query_row("SELECT id FROM assets", [], |row| row.get(0))
                    .expect("id"))
            })
            .expect("reader");
        (tmp, lib, id)
    }

    fn trash_then_purge(lib: &Library, id: &str) -> Result<(), AppError> {
        lib.with_writer(|conn| {
            conn.execute("UPDATE assets SET deleted_at = 1 WHERE id = ?1", [id])?;
            Ok(())
        })?;
        // Simulate purge synchronously: rows then files.
        let (rel, thumb) = lib.with_reader(|conn| {
            let rel: String =
                conn.query_row("SELECT rel_path FROM assets WHERE id = ?1", [id], |row| {
                    row.get(0)
                })?;
            Ok((rel, lib.thumb_path(id)))
        })?;
        lib.with_writer(|conn| {
            conn.execute("DELETE FROM assets WHERE id = ?1", [id])?;
            Ok(())
        })?;
        let _ = std::fs::remove_file(lib.resolve_rel(&rel));
        let _ = std::fs::remove_file(thumb);
        Ok(())
    }

    #[test]
    fn purge_removes_row_file_and_thumb() {
        let (_tmp, lib, id) = lib_with_imported_asset();

        let (file, thumb) = lib
            .with_reader(|conn| {
                let rel: String = conn.query_row(
                    "SELECT rel_path FROM assets WHERE id = ?1",
                    [id.as_str()],
                    |row| row.get(0),
                )?;
                Ok((lib.resolve_rel(&rel), lib.thumb_path(&id)))
            })
            .expect("reader");
        assert!(file.is_file());
        assert!(thumb.is_file());

        trash_then_purge(&lib, &id).expect("purge");

        let rows: i64 = lib
            .with_reader(|conn| {
                Ok(conn
                    .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
                    .expect("count"))
            })
            .expect("reader");
        assert_eq!(rows, 0);
        assert!(!file.exists());
        assert!(!thumb.exists());
    }

    #[test]
    fn restore_keeps_folder_membership() {
        let (_tmp, lib, id) = lib_with_imported_asset();
        lib.with_writer(|conn| {
            conn.execute_batch(
                "INSERT INTO folders (id, name, position, created_at, updated_at)
                 VALUES ('fa000000000000000001', 'F', 0, 0, 0);",
            )?;
            conn.execute(
                "INSERT INTO asset_folders (asset_id, folder_id, added_at)
                 VALUES (?1, 'fa000000000000000001', 0)",
                [id.as_str()],
            )?;
            // Soft-delete, then restore.
            conn.execute(
                "UPDATE assets SET deleted_at = 1 WHERE id = ?1",
                [id.as_str()],
            )?;
            conn.execute(
                "UPDATE assets SET deleted_at = NULL WHERE id = ?1",
                [id.as_str()],
            )?;
            Ok(())
        })
        .expect("round trip");

        let memberships: i64 = lib
            .with_reader(|conn| {
                Ok(conn
                    .query_row("SELECT COUNT(*) FROM asset_folders", [], |row| row.get(0))
                    .expect("count"))
            })
            .expect("reader");
        assert_eq!(memberships, 1, "restore lands back in the original folder");
    }
}
