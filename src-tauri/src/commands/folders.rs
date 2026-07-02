//! Folder commands: adjacency-list tree CRUD + asset membership.
//!
//! The frontend receives the *flat* list (with per-folder alive-asset counts)
//! and assembles the tree itself — folder counts are in the hundreds, so an
//! adjacency list plus one GROUP-BY query beats closure tables by a mile.

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::library::{new_id, now_ms};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub position: u32,
    /// Alive (non-trashed) assets directly in this folder.
    pub asset_count: u32,
    /// Unix ms.
    pub created_at: f64,
}

fn folder_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        name: row.get(2)?,
        position: row.get::<_, i64>(3)? as u32,
        asset_count: row.get::<_, i64>(4)? as u32,
        created_at: row.get::<_, i64>(5)? as f64,
    })
}

const FOLDER_SELECT: &str = "SELECT f.id, f.parent_id, f.name, f.position,
       (SELECT COUNT(*) FROM asset_folders af
          JOIN assets a ON a.id = af.asset_id
         WHERE af.folder_id = f.id AND a.deleted_at IS NULL) AS asset_count,
       f.created_at
  FROM folders f";

/// Flat folder list, siblings ordered by manual position then name.
#[tauri::command]
#[specta::specta]
pub async fn list_folders(state: tauri::State<'_, AppState>) -> AppResult<Vec<Folder>> {
    let library = state.current_library()?;
    library
        .read(|conn| {
            let mut stmt = conn.prepare(&format!(
                "{FOLDER_SELECT} ORDER BY f.position, f.name COLLATE NOCASE"
            ))?;
            let folders = stmt
                .query_map([], folder_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(folders)
        })
        .await
}

fn one_folder(conn: &rusqlite::Connection, id: &str) -> AppResult<Folder> {
    conn.query_row(
        &format!("{FOLDER_SELECT} WHERE f.id = ?1"),
        [id],
        folder_from_row,
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("folder {id}")),
        other => other.into(),
    })
}

fn validated_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Conflict("folder name must not be empty".into()));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn create_folder(
    name: String,
    parent_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<Folder> {
    let name = validated_name(&name)?;
    let library = state.current_library()?;
    library
        .write(move |conn| {
            if let Some(parent) = &parent_id {
                // Nicer error than the FK violation.
                one_folder(conn, parent)?;
            }
            let id = new_id();
            let now = now_ms();
            let position: i64 = conn.query_row(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM folders
                 WHERE parent_id IS ?1",
                [&parent_id],
                |row| row.get(0),
            )?;
            conn.execute(
                "INSERT INTO folders (id, parent_id, name, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                rusqlite::params![id, parent_id, name, position, now],
            )?;
            one_folder(conn, &id)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn rename_folder(
    id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<Folder> {
    let name = validated_name(&name)?;
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let changed = conn.execute(
                "UPDATE folders SET name = ?2, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![id, name, now_ms()],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("folder {id}")));
            }
            one_folder(conn, &id)
        })
        .await
}

/// True when `candidate` is `folder` itself or one of its descendants.
fn is_self_or_descendant(
    conn: &rusqlite::Connection,
    folder: &str,
    candidate: &str,
) -> AppResult<bool> {
    let count: i64 = conn.query_row(
        "WITH RECURSIVE subtree(id) AS (
           SELECT id FROM folders WHERE id = ?1
           UNION ALL
           SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
         )
         SELECT COUNT(*) FROM subtree WHERE id = ?2",
        [folder, candidate],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

#[tauri::command]
#[specta::specta]
pub async fn move_folder(
    id: String,
    new_parent_id: Option<String>,
    position: u32,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            if let Some(parent) = &new_parent_id {
                one_folder(conn, parent)?;
                if is_self_or_descendant(conn, &id, parent)? {
                    return Err(AppError::Conflict(
                        "cannot move a folder into itself or its subtree".into(),
                    ));
                }
            }
            let changed = conn.execute(
                "UPDATE folders SET parent_id = ?2, position = ?3, updated_at = ?4
                 WHERE id = ?1",
                rusqlite::params![id, new_parent_id, position, now_ms()],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("folder {id}")));
            }
            Ok(())
        })
        .await
}

/// Delete a folder and its whole subtree. Assets are never deleted — their
/// membership rows cascade away and they fall back to "uncategorized"
/// (Eagle semantics).
#[tauri::command]
#[specta::specta]
pub async fn delete_folder(id: String, state: tauri::State<'_, AppState>) -> AppResult<()> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let changed = conn.execute("DELETE FROM folders WHERE id = ?1", [&id])?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("folder {id}")));
            }
            Ok(())
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn add_assets_to_folder(
    asset_ids: Vec<String>,
    folder_id: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<u32> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            one_folder(conn, &folder_id)?;
            let now = now_ms();
            let tx = conn.transaction()?;
            let mut inserted = 0u32;
            {
                let mut stmt = tx.prepare(
                    "INSERT OR IGNORE INTO asset_folders (asset_id, folder_id, added_at)
                     SELECT id, ?2, ?3 FROM assets WHERE id = ?1",
                )?;
                for asset_id in &asset_ids {
                    inserted += stmt.execute(rusqlite::params![asset_id, folder_id, now])? as u32;
                }
            }
            tx.commit()?;
            Ok(inserted)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn remove_assets_from_folder(
    asset_ids: Vec<String>,
    folder_id: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<u32> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let tx = conn.transaction()?;
            let mut removed = 0u32;
            {
                let mut stmt =
                    tx.prepare("DELETE FROM asset_folders WHERE asset_id = ?1 AND folder_id = ?2")?;
                for asset_id in &asset_ids {
                    removed += stmt.execute(rusqlite::params![asset_id, folder_id])? as u32;
                }
            }
            tx.commit()?;
            Ok(removed)
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Library;

    fn lib() -> (tempfile::TempDir, Library) {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let lib = Library::create(&tmp.path().join("Lib")).expect("create");
        (tmp, lib)
    }

    fn insert_folder(lib: &Library, id: &str, parent: Option<&str>, name: &str) {
        lib.with_writer(|conn| {
            conn.execute(
                "INSERT INTO folders (id, parent_id, name, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 0, 0, 0)",
                rusqlite::params![id, parent, name],
            )?;
            Ok(())
        })
        .expect("insert folder");
    }

    #[test]
    fn cycle_detection_rejects_self_and_descendants() {
        let (_tmp, lib) = lib();
        insert_folder(&lib, "fa000000000000000001", None, "A");
        insert_folder(
            &lib,
            "fb000000000000000002",
            Some("fa000000000000000001"),
            "B",
        );
        insert_folder(
            &lib,
            "fc000000000000000003",
            Some("fb000000000000000002"),
            "C",
        );

        lib.with_reader(|conn| {
            // A → its own subtree members are self-or-descendant.
            assert!(is_self_or_descendant(
                conn,
                "fa000000000000000001",
                "fa000000000000000001"
            )?);
            assert!(is_self_or_descendant(
                conn,
                "fa000000000000000001",
                "fc000000000000000003"
            )?);
            // Sibling direction is fine.
            assert!(!is_self_or_descendant(
                conn,
                "fb000000000000000002",
                "fa000000000000000001"
            )?);
            Ok(())
        })
        .expect("reader");
    }

    #[test]
    fn delete_folder_cascades_subtree_but_keeps_assets() {
        let (_tmp, lib) = lib();
        insert_folder(&lib, "fa000000000000000001", None, "A");
        insert_folder(
            &lib,
            "fb000000000000000002",
            Some("fa000000000000000001"),
            "B",
        );
        lib.with_writer(|conn| {
            conn.execute_batch(
                "INSERT INTO assets (id, name, ext, size, hash_blake3, rel_path, imported_at, updated_at)
                 VALUES ('aa000000000000000001', 'x', 'png', 1, 'h', 'assets/aa/x.png', 0, 0);
                 INSERT INTO asset_folders (asset_id, folder_id, added_at)
                 VALUES ('aa000000000000000001', 'fb000000000000000002', 0);",
            )?;
            conn.execute("DELETE FROM folders WHERE id = 'fa000000000000000001'", [])?;
            Ok(())
        })
        .expect("delete");

        lib.with_reader(|conn| {
            let folders: i64 = conn.query_row("SELECT COUNT(*) FROM folders", [], |r| r.get(0))?;
            let memberships: i64 =
                conn.query_row("SELECT COUNT(*) FROM asset_folders", [], |r| r.get(0))?;
            let assets: i64 = conn.query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))?;
            assert_eq!(folders, 0);
            assert_eq!(memberships, 0);
            assert_eq!(assets, 1); // asset survives, now uncategorized
            Ok(())
        })
        .expect("reader");
    }
}
