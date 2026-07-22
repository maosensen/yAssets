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

/// Keyset page boundary: the previous page's last row. `sort_value` is that
/// row's ACTIVE-sort-column value stringified (name verbatim; numeric sorts —
/// imported_at/size/rating/updated_at — as a decimal integer string), `id` is
/// its id. The next page is everything ordered strictly after (value, id).
#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct ListCursor {
    pub sort_value: String,
    pub id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct AssetListQuery {
    pub scope: AssetScope,
    /// Full-text query over name + note (FTS5). None/empty = no text filter.
    pub search: Option<String>,
    /// Ad-hoc facets applied ON TOP of `scope` (orthogonal to it).
    /// Minimum star rating (inclusive).
    pub rating_min: Option<u8>,
    /// Keep only these lowercase extensions (ANY-of).
    pub types: Option<Vec<String>>,
    /// Keep assets carrying ANY of these tag ids.
    pub tag_ids: Option<Vec<String>>,
    pub sort: SortKey,
    pub dir: SortDir,
    /// Keyset pagination: fetch the page strictly after this boundary. When set,
    /// `offset` is ignored (cursor replaces it). Absent = first page.
    pub cursor: Option<ListCursor>,
    /// Legacy offset paging (still honored when `cursor` is None).
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
    /// `"file"` (normal managed file) or `"link"` (a bookmark whose cover is the
    /// page's Open Graph image). Drives the grid's link badge + open-in-browser.
    pub kind: String,
    /// Source/provenance URL. Carried on the summary so a link card can show its
    /// host and open in the browser without an extra fetch. None for most files.
    pub url: Option<String>,
    /// Unix ms.
    pub imported_at: f64,
    /// Unix ms of last metadata edit — carried so the keyset cursor for the
    /// UpdatedAt sort can be built from the loaded row.
    pub updated_at: f64,
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
    /// `"file"` or `"link"` — see `AssetSummary::kind`.
    pub kind: String,
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
    "id, name, ext, size, width, height, has_thumb, rating, imported_at, updated_at, duration_ms, kind, url";

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
        updated_at: row.get::<_, i64>(9)? as f64,
        duration_ms: row.get::<_, Option<i64>>(10)?.map(|v| v as f64),
        kind: row.get(11)?,
        url: row.get(12)?,
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

/// Turn free user text into a safe FTS5 MATCH string: split into alphanumeric
/// tokens and quote each as a prefix term (`"tok"*`), AND-joined. Quoting means
/// raw punctuation can never produce an FTS syntax error. None = no usable
/// tokens (caller then applies no text filter).
fn fts_match_query(term: &str) -> Option<String> {
    let tokens: Vec<String> = term
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
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
    // Stable id tiebreak — required for keyset paging (mirrored in keyset_predicate).
    format!("{column} {dir}, id {dir}")
}

/// The keyset `AND (...)` clause + params selecting rows strictly AFTER `cursor`
/// in the (sort, dir) order — the exact tiebreak `sort_sql` emits. Expanded
/// manually (not a `(col,id)` row-value tuple) so Name keeps `COLLATE NOCASE`;
/// direction mirrors dir (Desc → `<`, Asc → `>`).
fn keyset_predicate(
    sort: SortKey,
    dir: SortDir,
    cursor: &ListCursor,
) -> AppResult<(String, Vec<rusqlite::types::Value>)> {
    let column = match sort {
        SortKey::ImportedAt => "imported_at",
        SortKey::Name => "name COLLATE NOCASE",
        SortKey::Size => "size",
        SortKey::Rating => "rating",
        SortKey::UpdatedAt => "updated_at",
    };
    let cmp = match dir {
        SortDir::Asc => ">",
        SortDir::Desc => "<",
    };
    // Name compares as text; every other sort key is an integer column, so the
    // stringified cursor value must parse back to i64.
    let value = match sort {
        SortKey::Name => rusqlite::types::Value::Text(cursor.sort_value.clone()),
        _ => rusqlite::types::Value::Integer(
            cursor
                .sort_value
                .parse::<i64>()
                .map_err(|_| AppError::Conflict("invalid cursor value".into()))?,
        ),
    };
    let clause = format!(" AND ({column} {cmp} ? OR ({column} = ? AND id {cmp} ?))");
    Ok((
        clause,
        vec![
            value.clone(),
            value,
            rusqlite::types::Value::Text(cursor.id.clone()),
        ],
    ))
}

/// Build the `WHERE` clause + positional params for a list query: scope (smart
/// folders load their rules via `conn`), then the FTS text search, then the
/// faceted filters — appended in the order their params are pushed. Shared by
/// `list_assets` and the test harness so both exercise the same logic.
fn list_where(
    conn: &rusqlite::Connection,
    query: &AssetListQuery,
) -> AppResult<(String, Vec<rusqlite::types::Value>)> {
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
    // Text search → FTS5 over name+note (ranked, matches notes too). A term with
    // no usable tokens (pure punctuation) is treated as no search rather than
    // matching nothing.
    if let Some(match_query) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .and_then(fts_match_query)
    {
        where_clause.push_str(
            " AND assets.rowid IN \
             (SELECT rowid FROM assets_fts WHERE assets_fts MATCH ?)",
        );
        params.push(rusqlite::types::Value::Text(match_query));
    }
    // Faceted filters, appended after scope+search (positional params).
    if let Some(min) = query.rating_min {
        where_clause.push_str(" AND rating >= ?");
        params.push(rusqlite::types::Value::Integer(i64::from(min)));
    }
    if let Some(types) = query.types.as_ref().filter(|t| !t.is_empty()) {
        let placeholders = vec!["?"; types.len()].join(",");
        where_clause.push_str(&format!(" AND LOWER(ext) IN ({placeholders})"));
        for ext in types {
            params.push(rusqlite::types::Value::Text(ext.to_lowercase()));
        }
    }
    if let Some(tag_ids) = query.tag_ids.as_ref().filter(|t| !t.is_empty()) {
        let placeholders = vec!["?"; tag_ids.len()].join(",");
        where_clause.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM asset_tags at \
             WHERE at.asset_id = assets.id AND at.tag_id IN ({placeholders}))"
        ));
        for id in tag_ids {
            params.push(rusqlite::types::Value::Text(id.clone()));
        }
    }
    Ok((where_clause, params))
}

/// One page of a list query: `total` over scope+search+facets (cursor-agnostic),
/// then the page rows. When `cursor` is set it drives keyset paging (offset
/// ignored); otherwise legacy `offset` applies. Shared by the command and the
/// test harness so both exercise identical SQL.
fn list_page(conn: &rusqlite::Connection, query: &AssetListQuery) -> AppResult<AssetListResult> {
    let (where_clause, params) = list_where(conn, query)?;

    let total: u32 = conn.query_row(
        &format!("SELECT COUNT(*) FROM assets WHERE {where_clause}"),
        rusqlite::params_from_iter(params.iter()),
        |row| row.get::<_, i64>(0).map(|n| n as u32),
    )?;

    // The page rows carry the keyset boundary on top of the base predicate.
    let mut items_where = where_clause;
    let mut items_params = params;
    let paging = if let Some(cursor) = &query.cursor {
        let (clause, values) = keyset_predicate(query.sort, query.dir, cursor)?;
        items_where.push_str(&clause);
        items_params.extend(values);
        String::new() // keyset replaces OFFSET
    } else {
        format!(" OFFSET {}", query.offset.unwrap_or(0))
    };

    let limit = query.limit.unwrap_or(50_000).min(50_000);
    let sql = format!(
        "SELECT {SUMMARY_COLS} FROM assets WHERE {items_where}
         ORDER BY {} LIMIT {limit}{paging}",
        sort_sql(query.sort, query.dir),
    );
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(
            rusqlite::params_from_iter(items_params.iter()),
            summary_from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(AssetListResult { items, total })
}

#[tauri::command]
#[specta::specta]
pub async fn list_assets(
    query: AssetListQuery,
    state: tauri::State<'_, AppState>,
) -> AppResult<AssetListResult> {
    let library = state.current_library()?;
    library.read(move |conn| list_page(conn, &query)).await
}

/// Every id matching scope+search+facets, in sort order, unpaged. Shared by the
/// command and the test harness.
fn list_ids(conn: &rusqlite::Connection, query: &AssetListQuery) -> AppResult<Vec<String>> {
    let (where_clause, params) = list_where(conn, query)?;
    let sql = format!(
        "SELECT id FROM assets WHERE {where_clause} ORDER BY {}",
        sort_sql(query.sort, query.dir),
    );
    let mut stmt = conn.prepare(&sql)?;
    let ids = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

/// Every asset id matching this query's scope+search+facets, in sort order and
/// unpaged — backs "select all" so it covers rows not yet loaded by the grid.
#[tauri::command]
#[specta::specta]
pub async fn list_asset_ids(
    query: AssetListQuery,
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<String>> {
    let library = state.current_library()?;
    library.read(move |conn| list_ids(conn, &query)).await
}

fn detail_by_id(conn: &rusqlite::Connection, id: &str) -> AppResult<AssetDetail> {
    let mut detail = conn
        .query_row(
            "SELECT id, name, ext, mime, size, width, height, has_thumb, rating,
                    note, hash_blake3, src_path, imported_at, file_mtime,
                    file_ctime, updated_at, deleted_at, palette, url, kind
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
                    kind: row.get(19)?,
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

/// Set the same rating on many assets at once (batch metadata editing).
#[tauri::command]
#[specta::specta]
pub async fn set_assets_rating(
    asset_ids: Vec<String>,
    rating: u8,
    state: tauri::State<'_, AppState>,
) -> AppResult<u32> {
    if rating > 5 {
        return Err(AppError::Conflict("rating must be 0-5".into()));
    }
    let library = state.current_library()?;
    library
        .write(move |conn| {
            if asset_ids.is_empty() {
                return Ok(0);
            }
            let placeholders = vec!["?"; asset_ids.len()].join(",");
            let sql = format!(
                "UPDATE assets SET rating = ?, updated_at = ? WHERE id IN ({placeholders})"
            );
            let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(asset_ids.len() + 2);
            params.push(rusqlite::types::Value::Integer(i64::from(rating)));
            params.push(rusqlite::types::Value::Integer(now_ms()));
            for id in &asset_ids {
                params.push(rusqlite::types::Value::Text(id.clone()));
            }
            let changed = conn.execute(&sql, rusqlite::params_from_iter(params.iter()))?;
            Ok(changed as u32)
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
        // Exercise the real list SQL (scope + FTS + facets + keyset) synchronously.
        lib.with_reader(|conn| list_page(conn, &query))
            .expect("list")
    }

    fn q(scope: AssetScope) -> AssetListQuery {
        AssetListQuery {
            scope,
            search: None,
            rating_min: None,
            types: None,
            tag_ids: None,
            sort: SortKey::ImportedAt,
            dir: SortDir::Desc,
            cursor: None,
            offset: None,
            limit: None,
        }
    }

    /// Build the keyset cursor a client would send from a page's last row.
    fn cursor_from(sort: SortKey, item: &AssetSummary) -> ListCursor {
        let sort_value = match sort {
            SortKey::ImportedAt => (item.imported_at as i64).to_string(),
            SortKey::Name => item.name.clone(),
            SortKey::Size => (item.size as i64).to_string(),
            SortKey::Rating => (item.rating as i64).to_string(),
            SortKey::UpdatedAt => (item.updated_at as i64).to_string(),
        };
        ListCursor {
            sort_value,
            id: item.id.clone(),
        }
    }

    /// Walk the whole `All` list one keyset page at a time, returning ids in order.
    fn page_all(lib: &Library, sort: SortKey, dir: SortDir, page_size: u32) -> Vec<String> {
        let mut ids = Vec::new();
        let mut cursor: Option<ListCursor> = None;
        loop {
            let mut query = q(AssetScope::All);
            query.sort = sort;
            query.dir = dir;
            query.limit = Some(page_size);
            query.cursor = cursor.clone();
            let page = run_list(lib, query);
            if page.items.is_empty() {
                break;
            }
            cursor = Some(cursor_from(sort, page.items.last().expect("non-empty")));
            let n = page.items.len() as u32;
            ids.extend(page.items.into_iter().map(|it| it.id));
            if n < page_size {
                break;
            }
        }
        ids
    }

    /// Six alive assets with deliberate ties on name/size/rating/imported_at so
    /// the id tiebreak in the keyset predicate is actually exercised.
    fn tie_heavy_library() -> (tempfile::TempDir, Library) {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let lib = Library::create(&tmp.path().join("Lib")).expect("create");
        lib.with_writer(|conn| {
            conn.execute_batch(
                "INSERT INTO assets (id, name, ext, size, hash_blake3, rel_path,
                                     rating, imported_at, updated_at, deleted_at)
                 VALUES
                 ('asset000000000000001', 'apple', 'png', 10, 'h1', 'assets/a/1.png', 3, 1000, 1000, NULL),
                 ('asset000000000000002', 'apple', 'png', 10, 'h2', 'assets/a/2.png', 3, 1000, 2000, NULL),
                 ('asset000000000000003', 'banana', 'jpg', 20, 'h3', 'assets/a/3.jpg', 3, 3000, 3000, NULL),
                 ('asset000000000000004', 'cherry', 'gif', 20, 'h4', 'assets/a/4.gif', 5, 4000, 4000, NULL),
                 ('asset000000000000005', 'apple', 'txt', 30, 'h5', 'assets/a/5.txt', 1, 5000, 5000, NULL),
                 ('asset000000000000006', 'date', 'png', 30, 'h6', 'assets/a/6.png', 5, 6000, 6000, NULL);",
            )?;
            Ok(())
        })
        .expect("seed");
        (tmp, lib)
    }

    #[test]
    fn keyset_paging_covers_all_without_overlap() {
        let (_tmp, lib) = tie_heavy_library();
        let combos = [
            (SortKey::ImportedAt, SortDir::Desc),
            (SortKey::ImportedAt, SortDir::Asc),
            (SortKey::Name, SortDir::Asc),
            (SortKey::Name, SortDir::Desc),
            (SortKey::Rating, SortDir::Desc),
            (SortKey::Rating, SortDir::Asc),
            (SortKey::Size, SortDir::Asc),
            (SortKey::UpdatedAt, SortDir::Desc),
        ];
        for (sort, dir) in combos {
            let full: Vec<String> = {
                let mut query = q(AssetScope::All);
                query.sort = sort;
                query.dir = dir;
                run_list(&lib, query)
                    .items
                    .into_iter()
                    .map(|it| it.id)
                    .collect()
            };
            // Page size 2 over 6 rows forces page boundaries to fall on ties.
            let paged = page_all(&lib, sort, dir, 2);
            assert_eq!(
                paged, full,
                "paged order must equal full for {sort:?} {dir:?}"
            );
            let unique: std::collections::HashSet<&String> = paged.iter().collect();
            assert_eq!(unique.len(), paged.len(), "no overlap for {sort:?} {dir:?}");
            assert_eq!(paged.len(), 6, "no skips for {sort:?} {dir:?}");
        }
    }

    #[test]
    fn list_asset_ids_returns_full_ordered_set() {
        let (_tmp, lib) = tie_heavy_library();
        let mut query = q(AssetScope::All);
        query.sort = SortKey::Name;
        query.dir = SortDir::Asc;
        let via_ids = lib.with_reader(|conn| list_ids(conn, &query)).expect("ids");

        let mut query2 = q(AssetScope::All);
        query2.sort = SortKey::Name;
        query2.dir = SortDir::Asc;
        let via_list: Vec<String> = run_list(&lib, query2)
            .items
            .into_iter()
            .map(|it| it.id)
            .collect();

        assert_eq!(via_ids, via_list);
        assert_eq!(via_ids.len(), 6);
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
    fn fts_search_matches_name_and_note() {
        let (_tmp, lib) = seeded_library();
        // Name token.
        let by_name = run_list(
            &lib,
            AssetListQuery {
                search: Some("delta".into()),
                ..q(AssetScope::All)
            },
        );
        assert_eq!(by_name.total, 1);
        assert_eq!(by_name.items[0].name, "delta 100%");
        // Prefix within a name ("beta" → beta_file).
        assert_eq!(
            run_list(
                &lib,
                AssetListQuery {
                    search: Some("beta".into()),
                    ..q(AssetScope::All)
                }
            )
            .total,
            1
        );
        // Note content is searchable (the whole point of the FTS migration).
        lib.with_writer(|conn| {
            conn.execute(
                "UPDATE assets SET note = 'zephyr' WHERE id = 'asset000000000000001'",
                [],
            )?;
            Ok(())
        })
        .expect("note update");
        let by_note = run_list(
            &lib,
            AssetListQuery {
                search: Some("zephyr".into()),
                ..q(AssetScope::All)
            },
        );
        assert_eq!(by_note.total, 1);
        assert_eq!(by_note.items[0].name, "Alpha");
    }

    #[test]
    fn fts_search_of_pure_punctuation_is_a_no_op() {
        let (_tmp, lib) = seeded_library();
        // No alphanumeric tokens → no text filter (not "match nothing").
        assert_eq!(
            run_list(
                &lib,
                AssetListQuery {
                    search: Some("%$#".into()),
                    ..q(AssetScope::All)
                }
            )
            .total,
            3
        );
    }

    #[test]
    fn facets_stack_on_top_of_scope() {
        let (_tmp, lib) = seeded_library();
        // rating >= 3 → Alpha(3) + beta_file(5); delta(1) excluded.
        assert_eq!(
            run_list(
                &lib,
                AssetListQuery {
                    rating_min: Some(3),
                    ..q(AssetScope::All)
                }
            )
            .total,
            2
        );
        // type png → Alpha only.
        let png = run_list(
            &lib,
            AssetListQuery {
                types: Some(vec!["png".into()]),
                ..q(AssetScope::All)
            },
        );
        assert_eq!(png.total, 1);
        assert_eq!(png.items[0].name, "Alpha");
        // tag filter (ANY-of).
        lib.with_writer(|conn| {
            conn.execute_batch(
                "INSERT INTO tags (id, name, created_at) VALUES ('tag00000000000000001','fav',0);
                 INSERT INTO asset_tags (asset_id, tag_id)
                   VALUES ('asset000000000000002','tag00000000000000001');",
            )?;
            Ok(())
        })
        .expect("tag seed");
        let tagged = run_list(
            &lib,
            AssetListQuery {
                tag_ids: Some(vec!["tag00000000000000001".into()]),
                ..q(AssetScope::All)
            },
        );
        assert_eq!(tagged.total, 1);
        assert_eq!(tagged.items[0].name, "beta_file");
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

/// An asset the frontend capture worker should cover, plus its ext so the
/// worker can pick the right decoder (video frame / PDF page / HEIC image).
#[derive(Debug, Serialize, specta::Type)]
pub struct CoverCandidate {
    pub id: String,
    pub ext: String,
}

/// Assets still missing a cover whose format the WebView (not headless Rust)
/// must decode: video, PDF, and HEIC/HEIF. The worker grabs a frame/page/image
/// with the engine's own decoder and ships it back (see `set_video_thumbnail`
/// for video, `set_captured_thumbnail` for the rest). Extension list mirrors
/// `VIDEO_EXTS` and the HEIC/PDF handling in `src/lib/viewer-registry.ts`.
#[tauri::command]
#[specta::specta]
pub async fn list_cover_candidates(
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<CoverCandidate>> {
    let library = state.current_library()?;
    library
        .read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, ext FROM assets
                 WHERE deleted_at IS NULL AND has_thumb = 0
                   AND LOWER(ext) IN ('mp4', 'mov', 'm4v', 'webm', 'pdf', 'heic', 'heif')",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(CoverCandidate {
                        id: row.get(0)?,
                        ext: row.get(1)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await
}

/// Regenerate thumbnails for alive `managed` assets that lack one but whose
/// format is decodable headless in Rust (TIFF/ICO/PSD/Sketch added after they
/// were first imported). Best-effort: per-asset failures are logged and skipped;
/// formats needing the WebView (video/PDF/HEIC) are left to the capture worker.
/// Returns the number of covers filled — a cheap no-op when nothing is pending.
#[tauri::command]
#[specta::specta]
pub async fn backfill_missing_thumbnails(state: tauri::State<'_, AppState>) -> AppResult<u32> {
    let library = state.current_library()?;

    let pending: Vec<(String, String, String)> = library
        .read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, ext, rel_path FROM assets
                 WHERE deleted_at IS NULL AND has_thumb = 0 AND storage = 'managed'",
            )?;
            let rows = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await?;

    let mut filled = 0u32;
    for (id, ext, rel_path) in pending {
        let ext_lc = ext.to_lowercase();
        if !crate::import::thumbs::is_thumbable_ext(&ext_lc) {
            continue;
        }
        let src = library.resolve_rel(&rel_path);
        let dest = library.thumb_path(&id);
        let gen = tauri::async_runtime::spawn_blocking(move || {
            crate::import::thumbs::generate(&src, &dest, &ext_lc)
        })
        .await;
        let outcome = match gen {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(err)) => {
                log::warn!("backfill thumbnail failed for {id}: {err}");
                continue;
            }
            Err(err) => {
                log::error!("backfill task join failed for {id}: {err}");
                continue;
            }
        };
        let (width, height) = (outcome.width, outcome.height);
        let (hue, palette, dhash) = (outcome.hue, outcome.palette, outcome.dhash);
        let id_for_write = id.clone();
        let updated = library
            .write(move |conn| {
                conn.execute(
                    "UPDATE assets
                     SET has_thumb = 1, width = ?2, height = ?3,
                         hue = ?4, palette = ?5, dhash = ?6, updated_at = ?7
                     WHERE id = ?1 AND deleted_at IS NULL",
                    rusqlite::params![id_for_write, width, height, hue, palette, dhash, now_ms()],
                )?;
                Ok(())
            })
            .await;
        match updated {
            Ok(()) => filled += 1,
            Err(err) => log::warn!("backfill db update failed for {id}: {err}"),
        }
    }

    if filled > 0 {
        log::info!("backfilled {filled} thumbnail(s)");
    }
    Ok(filled)
}

/// Shared tail of the frontend-capture commands: validate the id, decode the
/// base64 frame (JPEG/PNG, ≤512px long edge), and run it through the same
/// WebP/color/dhash pipeline as image imports. Returns the pixel outcome so
/// callers can persist type-specific metadata (duration for video; none else).
async fn store_captured_frame(
    library: &crate::library::Library,
    asset_id: &str,
    frame_base64: String,
) -> AppResult<crate::import::thumbs::ThumbOutcome> {
    use base64::Engine;

    // The id becomes a thumbs/ path component — hold it to the id alphabet.
    let id_ok = (10..=32).contains(&asset_id.len())
        && asset_id
            .bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase());
    if !id_ok {
        return Err(AppError::Conflict("invalid asset id".into()));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(frame_base64.as_bytes())
        .map_err(|err| AppError::Conflict(format!("invalid frame data: {err}")))?;

    let dest = library.thumb_path(asset_id);
    tauri::async_runtime::spawn_blocking(move || {
        let img = image::load_from_memory(&bytes)
            .map_err(|err| AppError::Conflict(format!("frame decode failed: {err}")))?
            .to_rgba8();
        let (w, h) = (img.width(), img.height());
        crate::import::thumbs::write_from_rgba(img.into_raw(), w, h, &dest)
    })
    .await
    .map_err(|err| {
        log::error!("captured thumbnail task failed: {err}");
        AppError::Internal
    })?
}

/// Store a frontend-captured video frame as the asset's cover and record
/// playback metadata. `video_*`/`duration_ms` describe the SOURCE video, not
/// the captured frame.
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
    let library = state.current_library()?;
    let outcome = store_captured_frame(&library, &asset_id, frame_base64).await?;

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

/// Store a frontend-captured cover for a non-video format the WebView decoded
/// (PDF page 1, HEIC image). `width`/`height` are the SOURCE page/image size.
/// No duration is recorded — that column is video-only.
#[tauri::command]
#[specta::specta]
pub async fn set_captured_thumbnail(
    asset_id: String,
    frame_base64: String,
    width: u32,
    height: u32,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    let library = state.current_library()?;
    let outcome = store_captured_frame(&library, &asset_id, frame_base64).await?;

    library
        .write(move |conn| {
            conn.execute(
                "UPDATE assets
                 SET has_thumb = 1, width = ?2, height = ?3,
                     hue = ?4, palette = ?5, dhash = ?6, updated_at = ?7
                 WHERE id = ?1 AND deleted_at IS NULL",
                rusqlite::params![
                    asset_id,
                    width,
                    height,
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
