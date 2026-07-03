//! Tag commands: CRUD + batch assignment.
//!
//! Names are unique case-insensitively (schema-level `UNIQUE COLLATE
//! NOCASE`), so `create_tag` is create-or-get — typing an existing name in
//! the tag picker attaches the existing tag instead of erroring. Batch
//! endpoints take `Vec<asset_id> × Vec<tag_id>` so multi-select (P2-M2)
//! needs no new surface.

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::library::{new_id, now_ms};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct Tag {
    pub id: String,
    pub name: String,
    /// Optional display color (hex like `#3b82f6`); None → neutral dot.
    pub color: Option<String>,
    /// Alive (non-trashed) assets carrying this tag.
    pub asset_count: u32,
    /// Unix ms.
    pub created_at: f64,
}

const TAG_SELECT: &str = "SELECT t.id, t.name, t.color,
       (SELECT COUNT(*) FROM asset_tags at
          JOIN assets a ON a.id = at.asset_id
         WHERE at.tag_id = t.id AND a.deleted_at IS NULL) AS asset_count,
       t.created_at
  FROM tags t";

fn tag_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        asset_count: row.get::<_, i64>(3)? as u32,
        created_at: row.get::<_, i64>(4)? as f64,
    })
}

fn one_tag(conn: &rusqlite::Connection, id: &str) -> AppResult<Tag> {
    conn.query_row(&format!("{TAG_SELECT} WHERE t.id = ?1"), [id], tag_from_row)
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("tag {id}")),
            other => other.into(),
        })
}

fn validated_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Conflict("tag name must not be empty".into()));
    }
    Ok(trimmed.to_string())
}

/// All tags with usage counts, name-ordered.
#[tauri::command]
#[specta::specta]
pub async fn list_tags(state: tauri::State<'_, AppState>) -> AppResult<Vec<Tag>> {
    let library = state.current_library()?;
    library
        .read(|conn| {
            let mut stmt = conn.prepare(&format!("{TAG_SELECT} ORDER BY t.name COLLATE NOCASE"))?;
            let tags = stmt
                .query_map([], tag_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(tags)
        })
        .await
}

/// Create-or-get by (case-insensitive) name. An existing tag is returned
/// as-is; `color` only applies when the tag is newly created.
#[tauri::command]
#[specta::specta]
pub async fn create_tag(
    name: String,
    color: Option<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<Tag> {
    let name = validated_name(&name)?;
    let library = state.current_library()?;
    library
        .write(move |conn| {
            if let Ok(id) = conn.query_row(
                "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                [&name],
                |row| row.get::<_, String>(0),
            ) {
                return one_tag(conn, &id);
            }
            let id = new_id();
            conn.execute(
                "INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, name, color, now_ms()],
            )?;
            one_tag(conn, &id)
        })
        .await
}

/// Rename and/or recolor. Renaming onto another existing tag is rejected
/// (merge semantics are a later feature, not an accident).
#[tauri::command]
#[specta::specta]
pub async fn update_tag(
    id: String,
    name: Option<String>,
    color: Option<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<Tag> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            if let Some(name) = &name {
                let name = validated_name(name)?;
                let taken: bool = conn.query_row(
                    "SELECT COUNT(*) FROM tags WHERE name = ?1 COLLATE NOCASE AND id != ?2",
                    rusqlite::params![name, id],
                    |row| row.get::<_, i64>(0).map(|n| n > 0),
                )?;
                if taken {
                    return Err(AppError::Conflict("tag name already exists".into()));
                }
                conn.execute(
                    "UPDATE tags SET name = ?2 WHERE id = ?1",
                    rusqlite::params![id, name],
                )?;
            }
            if let Some(color) = &color {
                // Empty string clears the color.
                let value = if color.is_empty() {
                    None
                } else {
                    Some(color.clone())
                };
                conn.execute(
                    "UPDATE tags SET color = ?2 WHERE id = ?1",
                    rusqlite::params![id, value],
                )?;
            }
            one_tag(conn, &id)
        })
        .await
}

/// Delete a tag; memberships cascade away, assets are untouched.
#[tauri::command]
#[specta::specta]
pub async fn delete_tag(id: String, state: tauri::State<'_, AppState>) -> AppResult<()> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let changed = conn.execute("DELETE FROM tags WHERE id = ?1", [&id])?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("tag {id}")));
            }
            Ok(())
        })
        .await
}

/// Attach every tag to every asset (cartesian, INSERT OR IGNORE).
#[tauri::command]
#[specta::specta]
pub async fn add_tags_to_assets(
    asset_ids: Vec<String>,
    tag_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<u32> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let tx = conn.transaction()?;
            let mut inserted = 0u32;
            {
                let mut stmt = tx.prepare(
                    "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id)
                     SELECT id, ?2 FROM assets WHERE id = ?1",
                )?;
                for asset_id in &asset_ids {
                    for tag_id in &tag_ids {
                        inserted += stmt.execute(rusqlite::params![asset_id, tag_id])? as u32;
                    }
                }
            }
            tx.commit()?;
            Ok(inserted)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn remove_tags_from_assets(
    asset_ids: Vec<String>,
    tag_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<u32> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let tx = conn.transaction()?;
            let mut removed = 0u32;
            {
                let mut stmt =
                    tx.prepare("DELETE FROM asset_tags WHERE asset_id = ?1 AND tag_id = ?2")?;
                for asset_id in &asset_ids {
                    for tag_id in &tag_ids {
                        removed += stmt.execute(rusqlite::params![asset_id, tag_id])? as u32;
                    }
                }
            }
            tx.commit()?;
            Ok(removed)
        })
        .await
}

#[cfg(test)]
mod tests {
    use crate::library::Library;

    fn lib() -> (tempfile::TempDir, Library) {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let lib = Library::create(&tmp.path().join("Lib")).expect("create");
        (tmp, lib)
    }

    #[test]
    fn tag_names_are_case_insensitively_unique() {
        let (_tmp, lib) = lib();
        lib.with_writer(|conn| {
            conn.execute(
                "INSERT INTO tags (id, name, created_at) VALUES ('t1000000000000000001', 'Design', 0)",
                [],
            )?;
            let dup = conn.execute(
                "INSERT INTO tags (id, name, created_at) VALUES ('t2000000000000000002', 'design', 0)",
                [],
            );
            assert!(dup.is_err(), "NOCASE unique index must reject");
            Ok(())
        })
        .expect("writer");
    }

    #[test]
    fn deleting_tag_cascades_memberships_not_assets() {
        let (_tmp, lib) = lib();
        lib.with_writer(|conn| {
            conn.execute_batch(
                "INSERT INTO assets (id, name, ext, size, hash_blake3, rel_path, imported_at, updated_at)
                 VALUES ('aa000000000000000001', 'x', 'png', 1, 'h', 'assets/aa/x.png', 0, 0);
                 INSERT INTO tags (id, name, created_at) VALUES ('tt000000000000000001', 'T', 0);
                 INSERT INTO asset_tags (asset_id, tag_id)
                 VALUES ('aa000000000000000001', 'tt000000000000000001');",
            )?;
            conn.execute("DELETE FROM tags WHERE id = 'tt000000000000000001'", [])?;
            Ok(())
        })
        .expect("writer");
        lib.with_reader(|conn| {
            let memberships: i64 =
                conn.query_row("SELECT COUNT(*) FROM asset_tags", [], |r| r.get(0))?;
            let assets: i64 = conn.query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))?;
            assert_eq!(memberships, 0);
            assert_eq!(assets, 1);
            Ok(())
        })
        .expect("reader");
    }
}
