//! Asset read/update commands: the grid's list query, the inspector's
//! detail + patch, and reveal-in-Finder.
//!
//! specta red line: no 64-bit integers across IPC — byte sizes and
//! timestamps travel as `f64` (unix ms), dimensions as `u32`, rating as `u8`.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::library::now_ms;
use crate::state::AppState;

/// Which slice of the catalog a list query targets. Exported to TS as a
/// discriminated union on `kind`.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AssetScope {
    All,
    Uncategorized,
    Untagged,
    Recent {
        days: u32,
    },
    Folder {
        folder_id: String,
    },
    Tag {
        tag_id: String,
    },
    Color {
        hue: u8,
    },
    /// Saved rule set (see `commands::smart_folders`) resolved at list time.
    SmartFolder {
        smart_folder_id: String,
    },
    Trash,
}

#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
pub enum SortKey {
    ImportedAt,
    Name,
    Size,
    Rating,
    UpdatedAt,
}

#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
pub enum SortDir {
    Asc,
    Desc,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct AssetListQuery {
    pub scope: AssetScope,
    /// Filename substring filter (LIKE, `%_\` escaped).
    pub search: Option<String>,
    pub sort: SortKey,
    pub dir: SortDir,
    /// Paged contract from day one; phase 1 fetches everything in one call
    /// (`limit: 50000`). Above ~50k the frontend switches to keyset paging.
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

/// Everything the grid card needs — ~200 bytes/row over IPC.
#[derive(Debug, Serialize, specta::Type)]
pub struct AssetSummary {
    pub id: String,
    pub name: String,
    pub ext: String,
    /// Bytes.
    pub size: f64,
    /// Post-EXIF-orientation pixel dimensions; None for non-decoded formats.
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub has_thumb: bool,
    pub rating: u8,
    /// Unix ms.
    pub imported_at: f64,
    /// Source video duration in ms; None for non-video / not-yet-probed.
    pub duration_ms: Option<f64>,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct AssetListResult {
    pub items: Vec<AssetSummary>,
    /// Total rows matching scope+search, ignoring offset/limit.
    pub total: u32,
}

/// A tag as carried on an asset detail (no usage count needed here).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TagRef {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

/// Inspector payload — summary plus the heavier/editable fields.
#[derive(Debug, Serialize, specta::Type)]
pub struct AssetDetail {
    pub id: String,
    pub name: String,
    pub ext: String,
    pub mime: Option<String>,
    pub size: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub has_thumb: bool,
    pub rating: u8,
    pub note: String,
    pub hash_blake3: String,
    /// Original path at import time (provenance display only).
    pub src_path: Option<String>,
    /// User-editable source link (e.g. where the asset came from).
    pub url: Option<String>,
    pub folder_ids: Vec<String>,
    pub tags: Vec<TagRef>,
    /// Representative swatch hexes (JSON-decoded from the DB), for display.
    pub palette: Vec<String>,
    pub imported_at: f64,
    pub file_mtime: Option<f64>,
    pub file_ctime: Option<f64>,
    pub updated_at: f64,
    pub deleted_at: Option<f64>,
}

/// Partial update — absent fields stay untouched.
#[derive(Debug, Deserialize, specta::Type)]
pub struct AssetPatch {
    pub name: Option<String>,
    pub note: Option<String>,
    pub rating: Option<u8>,
    /// `Some("")` clears the link.
    pub url: Option<String>,
}

pub(crate) const SUMMARY_COLS: &str =
    "id, name, ext, size, width, height, has_thumb, rating, imported_at, duration_ms";

pub(crate) fn summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssetSummary> {
    Ok(AssetSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        ext: row.get(2)?,
        size: row.get::<_, i64>(3)? as f64,
        width: row.get(4)?,
        height: row.get(5)?,
        has_thumb: row.get(6)?,
        rating: row.get::<_, i64>(7)? as u8,
        imported_at: row.get::<_, i64>(8)? as f64,
        duration_ms: row.get::<_, Option<i64>>(9)?.map(|v| v as f64),
    })
}

/// (SQL predicate, positional params) for a scope. Positional params are
/// appended in order after any search param.
fn scope_sql(scope: &AssetScope) -> (String, Vec<rusqlite::types::Value>) {
    match scope {
        AssetScope::All => ("deleted_at IS NULL".into(), vec![]),
        AssetScope::Uncategorized => (
            "deleted_at IS NULL AND NOT EXISTS (
               SELECT 1 FROM asset_folders af WHERE af.asset_id = assets.id
             )"
            .into(),
            vec![],
        ),
        AssetScope::Untagged => (
            "deleted_at IS NULL AND NOT EXISTS (
               SELECT 1 FROM asset_tags at WHERE at.asset_id = assets.id
             )"
            .into(),
            vec![],
        ),
        AssetScope::Tag { tag_id } => (
            "deleted_at IS NULL AND EXISTS (
               SELECT 1 FROM asset_tags at
               WHERE at.asset_id = assets.id AND at.tag_id = ?
             )"
            .into(),
            vec![rusqlite::types::Value::Text(tag_id.clone())],
        ),
        AssetScope::Color { hue } => (
            "deleted_at IS NULL AND hue = ?".into(),
            vec![rusqlite::types::Value::Integer(i64::from(*hue))],
        ),
        AssetScope::Recent { days } => (
            "deleted_at IS NULL AND imported_at >= ?".into(),
            vec![rusqlite::types::Value::Integer(
                now_ms() - i64::from(*days) * 86_400_000,
            )],
        ),
        AssetScope::Folder { folder_id } => (
            "deleted_at IS NULL AND EXISTS (
               SELECT 1 FROM asset_folders af
               WHERE af.asset_id = assets.id AND af.folder_id = ?
             )"
            .into(),
            vec![rusqlite::types::Value::Text(folder_id.clone())],
        ),
        AssetScope::Trash => ("deleted_at IS NOT NULL".into(), vec![]),
        // Resolved in list_assets (needs a connection to load the rules);
        // defensive dead-end if it ever reaches here directly.
        AssetScope::SmartFolder { .. } => ("0 = 1".into(), vec![]),
    }
}

/// Escape `%`/`_`/`\` for a LIKE … ESCAPE '\' pattern.
pub(crate) fn escape_like(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn sort_sql(sort: SortKey, dir: SortDir) -> String {
    let column = match sort {
        SortKey::ImportedAt => "imported_at",
        SortKey::Name => "name COLLATE NOCASE",
        SortKey::Size => "size",
        SortKey::Rating => "rating",
        SortKey::UpdatedAt => "updated_at",
    };
    let dir = match dir {
        SortDir::Asc => "ASC",
        SortDir::Desc => "DESC",
    };
    // Stable id tiebreak — required for the future keyset-paging upgrade.
    format!("{column} {dir}, id {dir}")
}

#[tauri::command]
#[specta::specta]
pub async fn list_assets(
    query: AssetListQuery,
    state: tauri::State<'_, AppState>,
) -> AppResult<AssetListResult> {
    let library = state.current_library()?;
    library
        .read(move |conn| {
            let (predicate, mut params) = match &query.scope {
                // Smart folders need the connection: load rules, translate.
                AssetScope::SmartFolder { smart_folder_id } => {
                    let rules_json: String = conn
                        .query_row(
                            "SELECT rules FROM smart_folders WHERE id = ?1",
                            [smart_folder_id.as_str()],
                            |row| row.get(0),
                        )
                        .map_err(|_| AppError::NotFound("smart folder not found".into()))?;
                    let rules: crate::commands::smart_folders::SmartRules =
                        serde_json::from_str(&rules_json)
                            .map_err(|_| AppError::Conflict("invalid smart folder rules".into()))?;
                    crate::commands::smart_folders::rules_to_predicate(&rules)
                }
                other => scope_sql(other),
            };
            let mut where_clause = predicate;
            if let Some(term) = query
                .search
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
            {
                where_clause.push_str(" AND name LIKE ? ESCAPE '\\'");
                params.push(rusqlite::types::Value::Text(format!(
                    "%{}%",
                    escape_like(term)
                )));
            }

            let total: u32 = conn.query_row(
                &format!("SELECT COUNT(*) FROM assets WHERE {where_clause}"),
                rusqlite::params_from_iter(params.iter()),
                |row| row.get::<_, i64>(0).map(|n| n as u32),
            )?;

            let limit = query.limit.unwrap_or(50_000).min(50_000);
            let offset = query.offset.unwrap_or(0);
            let sql = format!(
                "SELECT {SUMMARY_COLS} FROM assets WHERE {where_clause}
                 ORDER BY {} LIMIT {limit} OFFSET {offset}",
                sort_sql(query.sort, query.dir),
            );
            let mut stmt = conn.prepare(&sql)?;
            let items = stmt
                .query_map(rusqlite::params_from_iter(params.iter()), summary_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            Ok(AssetListResult { items, total })
        })
        .await
}

fn detail_by_id(conn: &rusqlite::Connection, id: &str) -> AppResult<AssetDetail> {
    let mut detail = conn
        .query_row(
            "SELECT id, name, ext, mime, size, width, height, has_thumb, rating,
                    note, hash_blake3, src_path, imported_at, file_mtime,
                    file_ctime, updated_at, deleted_at, palette, url
             FROM assets WHERE id = ?1",
            [id],
            |row| {
                let palette = row
                    .get::<_, Option<String>>(17)?
                    .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
                    .unwrap_or_default();
                Ok(AssetDetail {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    ext: row.get(2)?,
                    mime: row.get(3)?,
                    size: row.get::<_, i64>(4)? as f64,
                    width: row.get(5)?,
                    height: row.get(6)?,
                    has_thumb: row.get(7)?,
                    rating: row.get::<_, i64>(8)? as u8,
                    note: row.get(9)?,
                    hash_blake3: row.get(10)?,
                    src_path: row.get(11)?,
                    url: row.get(18)?,
                    folder_ids: Vec::new(),
                    tags: Vec::new(),
                    palette,
                    imported_at: row.get::<_, i64>(12)? as f64,
                    file_mtime: row.get::<_, Option<i64>>(13)?.map(|v| v as f64),
                    file_ctime: row.get::<_, Option<i64>>(14)?.map(|v| v as f64),
                    updated_at: row.get::<_, i64>(15)? as f64,
                    deleted_at: row.get::<_, Option<i64>>(16)?.map(|v| v as f64),
                })
            },
        )
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("asset {id}")),
            other => other.into(),
        })?;

    let mut stmt = conn.prepare("SELECT folder_id FROM asset_folders WHERE asset_id = ?1")?;
    detail.folder_ids = stmt
        .query_map([id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;

    let mut tag_stmt = conn.prepare(
        "SELECT t.id, t.name, t.color FROM asset_tags at
         JOIN tags t ON t.id = at.tag_id
         WHERE at.asset_id = ?1
         ORDER BY t.name COLLATE NOCASE",
    )?;
    detail.tags = tag_stmt
        .query_map([id], |row| {
            Ok(TagRef {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(detail)
}

#[tauri::command]
#[specta::specta]
pub async fn get_asset(id: String, state: tauri::State<'_, AppState>) -> AppResult<AssetDetail> {
    let library = state.current_library()?;
    library.read(move |conn| detail_by_id(conn, &id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_asset(
    id: String,
    patch: AssetPatch,
    state: tauri::State<'_, AppState>,
) -> AppResult<AssetDetail> {
    if let Some(rating) = patch.rating {
        if rating > 5 {
            return Err(AppError::Conflict("rating must be 0-5".into()));
        }
    }
    if let Some(name) = patch.name.as_deref() {
        if name.trim().is_empty() {
            return Err(AppError::Conflict("name must not be empty".into()));
        }
    }

    let library = state.current_library()?;
    library
        .write(move |conn| {
            let tx = conn.transaction()?;
            if let Some(name) = &patch.name {
                tx.execute(
                    "UPDATE assets SET name = ?2 WHERE id = ?1",
                    rusqlite::params![id, name.trim()],
                )?;
            }
            if let Some(note) = &patch.note {
                tx.execute(
                    "UPDATE assets SET note = ?2 WHERE id = ?1",
                    rusqlite::params![id, note],
                )?;
            }
            if let Some(rating) = patch.rating {
                tx.execute(
                    "UPDATE assets SET rating = ?2 WHERE id = ?1",
                    rusqlite::params![id, rating],
                )?;
            }
            if let Some(url) = &patch.url {
                let trimmed = url.trim();
                tx.execute(
                    "UPDATE assets SET url = ?2 WHERE id = ?1",
                    rusqlite::params![id, (!trimmed.is_empty()).then_some(trimmed)],
                )?;
            }
            let changed = tx.execute(
                "UPDATE assets SET updated_at = ?2 WHERE id = ?1",
                rusqlite::params![id, now_ms()],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("asset {id}")));
            }
            let detail = detail_by_id(&tx, &id)?;
            tx.commit()?;
            Ok(detail)
        })
        .await
}

/// Reveal the managed file in Finder / Explorer. The frontend never learns
/// the absolute path — the OS shows it directly.
#[tauri::command]
#[specta::specta]
pub async fn reveal_asset(id: String, state: tauri::State<'_, AppState>) -> AppResult<()> {
    let library = state.current_library()?;
    let lib = library.clone();
    let rel: String = library
        .read(move |conn| {
            conn.query_row(
                "SELECT rel_path FROM assets WHERE id = ?1",
                [id.as_str()],
                |row| row.get(0),
            )
            .map_err(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("asset {id}")),
                other => other.into(),
            })
        })
        .await?;
    let path = lib.resolve_rel(&rel);
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|err| {
        log::error!("reveal failed: {err}");
        AppError::Io("failed to reveal file".into())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Library;

    fn seeded_library() -> (tempfile::TempDir, Library) {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let lib = Library::create(&tmp.path().join("Lib")).expect("create");
        lib.with_writer(|conn| {
            conn.execute_batch(
                "INSERT INTO folders (id, name, position, created_at, updated_at)
                 VALUES ('folder0000000000000a', 'F', 0, 0, 0);
                 INSERT INTO assets (id, name, ext, size, hash_blake3, rel_path,
                                     rating, imported_at, updated_at, deleted_at)
                 VALUES
                 ('asset000000000000001', 'Alpha', 'png', 10, 'h1', 'assets/as/1.png', 3, 1000, 1000, NULL),
                 ('asset000000000000002', 'beta_file', 'jpg', 20, 'h2', 'assets/as/2.jpg', 5, 2000, 2000, NULL),
                 ('asset000000000000003', 'Gamma', 'txt', 30, 'h3', 'assets/as/3.txt', 0, 3000, 3000, 4000),
                 ('asset000000000000004', 'delta 100%', 'gif', 40, 'h4', 'assets/as/4.gif', 1, 4000, 4000, NULL);
                 INSERT INTO asset_folders (asset_id, folder_id, added_at)
                 VALUES ('asset000000000000002', 'folder0000000000000a', 0);",
            )?;
            Ok(())
        })
        .expect("seed");
        (tmp, lib)
    }

    fn run_list(lib: &Library, query: AssetListQuery) -> AssetListResult {
        // Reuse the command's inner logic synchronously via with_reader.
        lib.with_reader(|conn| {
            let (predicate, mut params) = scope_sql(&query.scope);
            let mut where_clause = predicate;
            if let Some(term) = query
                .search
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
            {
                where_clause.push_str(" AND name LIKE ? ESCAPE '\\'");
                params.push(rusqlite::types::Value::Text(format!(
                    "%{}%",
                    escape_like(term)
                )));
            }
            let total: u32 = conn.query_row(
                &format!("SELECT COUNT(*) FROM assets WHERE {where_clause}"),
                rusqlite::params_from_iter(params.iter()),
                |row| row.get::<_, i64>(0).map(|n| n as u32),
            )?;
            let sql = format!(
                "SELECT {SUMMARY_COLS} FROM assets WHERE {where_clause} ORDER BY {}",
                sort_sql(query.sort, query.dir),
            );
            let mut stmt = conn.prepare(&sql)?;
            let items = stmt
                .query_map(rusqlite::params_from_iter(params.iter()), summary_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(AssetListResult { items, total })
        })
        .expect("list")
    }

    fn q(scope: AssetScope) -> AssetListQuery {
        AssetListQuery {
            scope,
            search: None,
            sort: SortKey::ImportedAt,
            dir: SortDir::Desc,
            offset: None,
            limit: None,
        }
    }

    #[test]
    fn scopes_slice_correctly() {
        let (_tmp, lib) = seeded_library();
        assert_eq!(run_list(&lib, q(AssetScope::All)).total, 3); // trashed excluded
        assert_eq!(run_list(&lib, q(AssetScope::Trash)).total, 1);
        assert_eq!(run_list(&lib, q(AssetScope::Uncategorized)).total, 2); // alpha, delta
        assert_eq!(
            run_list(
                &lib,
                q(AssetScope::Folder {
                    folder_id: "folder0000000000000a".into()
                })
            )
            .total,
            1
        );
    }

    #[test]
    fn sort_and_order_apply() {
        let (_tmp, lib) = seeded_library();
        let by_name = run_list(
            &lib,
            AssetListQuery {
                sort: SortKey::Name,
                dir: SortDir::Asc,
                ..q(AssetScope::All)
            },
        );
        let names: Vec<&str> = by_name.items.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "beta_file", "delta 100%"]); // NOCASE
    }

    #[test]
    fn search_is_escaped_and_case_insensitive_default() {
        let (_tmp, lib) = seeded_library();
        // `%` in the term must match literally, not as a wildcard.
        let percent = run_list(
            &lib,
            AssetListQuery {
                search: Some("100%".into()),
                ..q(AssetScope::All)
            },
        );
        assert_eq!(percent.total, 1);
        assert_eq!(percent.items[0].name, "delta 100%");

        // `_` likewise.
        let underscore = run_list(
            &lib,
            AssetListQuery {
                search: Some("beta_".into()),
                ..q(AssetScope::All)
            },
        );
        assert_eq!(underscore.total, 1);

        // A wildcard-abusing term must not match everything.
        let wild = run_list(
            &lib,
            AssetListQuery {
                search: Some("%".into()),
                ..q(AssetScope::All)
            },
        );
        assert_eq!(wild.total, 1); // only the literal-% name
    }

    #[test]
    fn detail_includes_folders_and_404s() {
        let (_tmp, lib) = seeded_library();
        lib.with_reader(|conn| {
            let detail = detail_by_id(conn, "asset000000000000002").expect("detail");
            assert_eq!(detail.folder_ids, vec!["folder0000000000000a".to_string()]);
            assert!(matches!(
                detail_by_id(conn, "nope0000000000000000"),
                Err(AppError::NotFound(_))
            ));
            Ok(())
        })
        .expect("reader");
    }
}

/// Video assets still missing a cover — the queue for the frontend capture
/// worker (the WebView's own decoder grabs a frame; see `set_video_thumbnail`).
/// Extension list mirrors `VIDEO_EXTS` in `src/lib/viewer-registry.ts`.
#[tauri::command]
#[specta::specta]
pub async fn list_video_thumb_candidates(
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<String>> {
    let library = state.current_library()?;
    library
        .read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM assets
                 WHERE deleted_at IS NULL AND has_thumb = 0
                   AND ext IN ('mp4', 'mov', 'm4v', 'webm')",
            )?;
            let ids = stmt
                .query_map([], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<String>>>()?;
            Ok(ids)
        })
        .await
}

/// Store a frontend-captured video frame as the asset's cover and record
/// playback metadata. The frame arrives base64-encoded (JPEG/PNG, ≤512px
/// long edge) and runs through the same WebP/color/dhash pipeline as image
/// imports; `video_*`/`duration_ms` describe the SOURCE video, not the frame.
#[tauri::command]
#[specta::specta]
pub async fn set_video_thumbnail(
    asset_id: String,
    frame_base64: String,
    video_width: u32,
    video_height: u32,
    duration_ms: f64,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    use base64::Engine;

    // The id becomes a thumbs/ path component — hold it to the id alphabet.
    let id_ok = (10..=32).contains(&asset_id.len())
        && asset_id
            .bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase());
    if !id_ok {
        return Err(AppError::Conflict("invalid asset id".into()));
    }

    let library = state.current_library()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(frame_base64.as_bytes())
        .map_err(|err| AppError::Conflict(format!("invalid frame data: {err}")))?;

    let dest = library.thumb_path(&asset_id);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let img = image::load_from_memory(&bytes)
            .map_err(|err| AppError::Conflict(format!("frame decode failed: {err}")))?
            .to_rgba8();
        let (w, h) = (img.width(), img.height());
        crate::import::thumbs::write_from_rgba(img.into_raw(), w, h, &dest)
    })
    .await
    .map_err(|err| {
        log::error!("video thumbnail task failed: {err}");
        AppError::Internal
    })??;

    let duration = duration_ms.is_finite().then_some(duration_ms as i64);
    library
        .write(move |conn| {
            conn.execute(
                "UPDATE assets
                 SET has_thumb = 1, width = ?2, height = ?3, duration_ms = ?4,
                     hue = ?5, palette = ?6, dhash = ?7, updated_at = ?8
                 WHERE id = ?1 AND deleted_at IS NULL",
                rusqlite::params![
                    asset_id,
                    video_width,
                    video_height,
                    duration,
                    outcome.hue,
                    outcome.palette,
                    outcome.dhash,
                    now_ms(),
                ],
            )?;
            Ok(())
        })
        .await
}

/// Visual similarity search (dHash, layer L2 of the duplicate strategy):
/// popcount the target's fingerprint against every alive asset, return
/// summaries ordered by distance (the target itself leads at distance 0).
/// Capped at 200 hits — also keeps the follow-up IN() under SQLite's
/// parameter limit.
#[tauri::command]
#[specta::specta]
pub async fn find_similar_assets(
    asset_id: String,
    max_distance: u32,
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<AssetSummary>> {
    let library = state.current_library()?;
    let max_distance = max_distance.min(20);
    library
        .read(move |conn| {
            let target: Option<i64> = conn
                .query_row(
                    "SELECT dhash FROM assets WHERE id = ?1 AND deleted_at IS NULL",
                    [asset_id.as_str()],
                    |row| row.get(0),
                )
                .map_err(|_| AppError::NotFound("asset not found".into()))?;
            let Some(target) = target else {
                return Err(AppError::Conflict(
                    "asset has no visual fingerprint yet".into(),
                ));
            };

            // Whole-library popcount sweep — a few ms even at 10k assets.
            let mut stmt = conn.prepare(
                "SELECT id, dhash FROM assets
                 WHERE deleted_at IS NULL AND dhash IS NOT NULL",
            )?;
            let mut matches: Vec<(u32, String)> = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })?
                .filter_map(Result::ok)
                .filter_map(|(id, hash)| {
                    let d = crate::import::dhash::distance(target as u64, hash as u64);
                    (d <= max_distance).then_some((d, id))
                })
                .collect();
            matches.sort();
            matches.truncate(200);
            if matches.is_empty() {
                return Ok(Vec::new());
            }

            // Fetch summaries in one IN(), then re-emit in distance order.
            let ids: Vec<String> = matches.into_iter().map(|(_, id)| id).collect();
            let placeholders = vec!["?"; ids.len()].join(",");
            let sql = format!("SELECT {SUMMARY_COLS} FROM assets WHERE id IN ({placeholders})");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(ids.iter()), summary_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut by_id: std::collections::HashMap<String, AssetSummary> =
                rows.into_iter().map(|s| (s.id.clone(), s)).collect();
            Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
        })
        .await
}
