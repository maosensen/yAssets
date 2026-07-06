//! Watched-folder commands: CRUD over the v8 `watched_folders` table. Each row
//! is an external directory the app auto-imports new files from. The live
//! filesystem watcher and the rescan pass that consume these rows are wired in
//! `library::watch` (started from `install_library`).

use rusqlite::OptionalExtension;
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::library::{new_id, now_ms};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct WatchedFolder {
    pub id: String,
    pub path: String,
    /// Library folder new files import into; None = library root.
    pub folder_id: Option<String>,
    pub auto_import: bool,
    /// Unix ms of the last reconciliation pass; None = never scanned.
    pub last_scanned_at: Option<f64>,
    /// Unix ms.
    pub created_at: f64,
}

const WATCHED_COLS: &str = "id, path, folder_id, auto_import, last_scanned_at, created_at";

fn watched_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WatchedFolder> {
    Ok(WatchedFolder {
        id: row.get(0)?,
        path: row.get(1)?,
        folder_id: row.get(2)?,
        auto_import: row.get::<_, i64>(3)? != 0,
        last_scanned_at: row.get::<_, Option<i64>>(4)?.map(|v| v as f64),
        created_at: row.get::<_, i64>(5)? as f64,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_watched_folders(
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<WatchedFolder>> {
    let library = state.current_library()?;
    library
        .read(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {WATCHED_COLS} FROM watched_folders ORDER BY created_at"
            ))?;
            let rows = stmt
                .query_map([], watched_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn add_watched_folder(
    path: String,
    folder_id: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<WatchedFolder> {
    let library = state.current_library()?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(AppError::Conflict("empty path".into()));
    }
    // Canonicalize first so `..` segments / symlinks can't smuggle a path INTO
    // the library — otherwise the watcher would observe the app's own writes and
    // the reconcile pass would re-import the library into itself. The resolved
    // path is what we store and watch.
    let candidate = std::fs::canonicalize(&path)
        .map_err(|_| AppError::NotFound(format!("folder not found: {path}")))?;
    let root =
        std::fs::canonicalize(library.root()).unwrap_or_else(|_| library.root().to_path_buf());
    if candidate.starts_with(&root) || root.starts_with(&candidate) {
        return Err(AppError::Conflict(
            "cannot watch the library folder or a parent of it".into(),
        ));
    }
    let path = candidate.to_string_lossy().into_owned();

    let row = library
        .write(move |conn| {
            if let Some(folder) = &folder_id {
                let exists = conn
                    .query_row("SELECT 1 FROM folders WHERE id = ?1", [folder], |_| Ok(()))
                    .optional()?
                    .is_some();
                if !exists {
                    return Err(AppError::NotFound(format!("folder {folder}")));
                }
            }
            let id = new_id();
            let now = now_ms();
            conn.execute(
                "INSERT INTO watched_folders
                   (id, path, folder_id, auto_import, last_scanned_at, created_at)
                 VALUES (?1, ?2, ?3, 1, NULL, ?4)",
                rusqlite::params![id, path, folder_id, now],
            )
            .map_err(|err| {
                if err.to_string().contains("UNIQUE") {
                    AppError::Conflict("this folder is already watched".into())
                } else {
                    AppError::from(err)
                }
            })?;
            let row = conn.query_row(
                &format!("SELECT {WATCHED_COLS} FROM watched_folders WHERE id = ?1"),
                [&id],
                watched_from_row,
            )?;
            Ok(row)
        })
        .await?;
    // Pick up the new folder without reopening the library.
    crate::library::watch::restart(&app, &state, &library);
    Ok(row)
}

#[tauri::command]
#[specta::specta]
pub async fn set_watched_folder_enabled(
    id: String,
    enabled: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let changed = conn.execute(
                "UPDATE watched_folders SET auto_import = ?2 WHERE id = ?1",
                rusqlite::params![id, i64::from(enabled)],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("watched folder {id}")));
            }
            Ok(())
        })
        .await?;
    crate::library::watch::restart(&app, &state, &library);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn remove_watched_folder(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            let changed = conn.execute("DELETE FROM watched_folders WHERE id = ?1", [&id])?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("watched folder {id}")));
            }
            Ok(())
        })
        .await?;
    crate::library::watch::restart(&app, &state, &library);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Library;

    fn test_library() -> (tempfile::TempDir, Library) {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let lib = Library::create(&tmp.path().join("Lib")).expect("create");
        (tmp, lib)
    }

    /// Direct-to-DB mirrors of the command bodies (commands need Tauri State).
    fn insert(lib: &Library, path: &str, folder_id: Option<&str>) -> AppResult<WatchedFolder> {
        let root = lib.root().to_path_buf();
        let candidate = std::path::PathBuf::from(path);
        if candidate.starts_with(&root) || root.starts_with(&candidate) {
            return Err(AppError::Conflict("inside library".into()));
        }
        lib.with_writer(|conn| {
            let id = new_id();
            conn.execute(
                "INSERT INTO watched_folders
                   (id, path, folder_id, auto_import, last_scanned_at, created_at)
                 VALUES (?1, ?2, ?3, 1, NULL, ?4)",
                rusqlite::params![id, path, folder_id, now_ms()],
            )
            .map_err(|err| {
                if err.to_string().contains("UNIQUE") {
                    AppError::Conflict("already watched".into())
                } else {
                    AppError::from(err)
                }
            })?;
            let row = conn.query_row(
                &format!("SELECT {WATCHED_COLS} FROM watched_folders WHERE id = ?1"),
                [&id],
                watched_from_row,
            )?;
            Ok(row)
        })
    }

    fn list(lib: &Library) -> Vec<WatchedFolder> {
        lib.with_reader(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {WATCHED_COLS} FROM watched_folders ORDER BY created_at"
            ))?;
            let rows = stmt
                .query_map([], watched_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .expect("list")
    }

    #[test]
    fn add_list_remove_roundtrip() {
        let (tmp, lib) = test_library();
        let outside = tmp.path().join("Watched").to_string_lossy().into_owned();
        let row = insert(&lib, &outside, None).expect("add");
        assert_eq!(row.path, outside);
        assert!(row.auto_import);
        assert_eq!(list(&lib).len(), 1);

        lib.with_writer(|conn| {
            conn.execute("DELETE FROM watched_folders WHERE id = ?1", [&row.id])?;
            Ok(())
        })
        .expect("remove");
        assert_eq!(list(&lib).len(), 0);
    }

    #[test]
    fn duplicate_path_is_a_conflict() {
        let (tmp, lib) = test_library();
        let p = tmp.path().join("W").to_string_lossy().into_owned();
        insert(&lib, &p, None).expect("first");
        assert!(matches!(insert(&lib, &p, None), Err(AppError::Conflict(_))));
    }

    #[test]
    fn rejects_watching_inside_the_library() {
        let (_tmp, lib) = test_library();
        let inside = lib.root().join("sub").to_string_lossy().into_owned();
        assert!(matches!(
            insert(&lib, &inside, None),
            Err(AppError::Conflict(_))
        ));
    }
}
