//! Smart folders — saved rule sets that materialize as live queries.
//!
//! Rules are stored as JSON in `smart_folders.rules` and translated into a
//! SQL predicate at list time (`rules_to_predicate`, consumed by
//! `list_assets` for `AssetScope::SmartFolder`). There are no membership
//! rows: a smart folder is always current, by construction.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::library::{new_id, now_ms};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SmartRules {
    /// `false` = every condition must hold (AND); `true` = any may (OR).
    pub match_any: bool,
    pub conditions: Vec<SmartCondition>,
}

/// One rule row. Exported to TS as a discriminated union on `field`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "field", rename_all = "snake_case")]
pub enum SmartCondition {
    /// Extension is one of `values` (compared lowercased).
    Ext {
        values: Vec<String>,
    },
    /// Asset's broad media kind. Unlike `Ext`, the extension list lives in
    /// code (`exts_for_kind`), so folders built on this condition follow the
    /// app as new formats gain support — an `Ext` list is frozen at creation.
    MediaKind {
        value: MediaKindValue,
    },
    /// Filename contains `value` (case-insensitive via NOCASE-ish LIKE).
    NameContains {
        value: String,
    },
    RatingAtLeast {
        min: u8,
    },
    /// Dominant-hue bucket equals `value` (0-11 chromatic, 12 neutral).
    Hue {
        value: u8,
    },
    HasTag {
        tag_id: String,
    },
    AddedWithinDays {
        days: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum MediaKindValue {
    Image,
    Video,
    Audio,
    Document,
}

/// Classification, not playability: `mkv` IS a video even though no WebView
/// plays it. The rendering-support sets in `src/lib/viewer-registry.ts` are a
/// different concern — don't merge the two. Extending a list here retroactively
/// widens every smart folder built on that kind.
pub(crate) fn exts_for_kind(kind: MediaKindValue) -> &'static [&'static str] {
    match kind {
        MediaKindValue::Image => &[
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif", "tiff", "tif",
            "heic", "heif", "jxl", "psd", "psb", "sketch", "ora", "kra",
        ],
        MediaKindValue::Video => &[
            "mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "m2ts",
            "3gp",
        ],
        MediaKindValue::Audio => &[
            "mp3", "m4a", "aac", "wav", "flac", "aiff", "ogg", "opus", "wma", "mid", "midi",
        ],
        // Prose and office files; source code stays out — a "Documents" folder
        // full of stray .ts files would read as a bug to most users.
        MediaKindValue::Document => &[
            "pdf", "md", "markdown", "mdx", "txt", "rtf", "doc", "docx", "xls", "xlsx", "ppt",
            "pptx", "key", "pages", "numbers", "odt", "ods", "odp", "csv", "epub",
        ],
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub rules: SmartRules,
    pub position: u32,
}

/// Translate rules into a WHERE predicate over `assets` (always scoped to
/// alive rows). Empty condition lists match everything alive.
pub(crate) fn rules_to_predicate(rules: &SmartRules) -> (String, Vec<rusqlite::types::Value>) {
    use rusqlite::types::Value;

    if rules.conditions.is_empty() {
        return ("deleted_at IS NULL".into(), vec![]);
    }
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Value> = Vec::new();
    for condition in &rules.conditions {
        match condition {
            SmartCondition::Ext { values } => {
                if values.is_empty() {
                    clauses.push("0 = 1".into());
                    continue;
                }
                let placeholders = vec!["?"; values.len()].join(",");
                clauses.push(format!("LOWER(ext) IN ({placeholders})"));
                params.extend(values.iter().map(|v| Value::Text(v.trim().to_lowercase())));
            }
            SmartCondition::MediaKind { value } => {
                let exts = exts_for_kind(*value);
                let placeholders = vec!["?"; exts.len()].join(",");
                clauses.push(format!("LOWER(ext) IN ({placeholders})"));
                params.extend(exts.iter().map(|e| Value::Text((*e).to_string())));
            }
            SmartCondition::NameContains { value } => {
                clauses.push("name LIKE ? ESCAPE '\\'".into());
                params.push(Value::Text(format!(
                    "%{}%",
                    crate::commands::assets::escape_like(value)
                )));
            }
            SmartCondition::RatingAtLeast { min } => {
                clauses.push("rating >= ?".into());
                params.push(Value::Integer(i64::from(*min)));
            }
            SmartCondition::Hue { value } => {
                clauses.push("hue = ?".into());
                params.push(Value::Integer(i64::from(*value)));
            }
            SmartCondition::HasTag { tag_id } => {
                clauses.push(
                    "EXISTS (SELECT 1 FROM asset_tags at
                      WHERE at.asset_id = assets.id AND at.tag_id = ?)"
                        .into(),
                );
                params.push(Value::Text(tag_id.clone()));
            }
            SmartCondition::AddedWithinDays { days } => {
                clauses.push("imported_at >= ?".into());
                params.push(Value::Integer(now_ms() - i64::from(*days) * 86_400_000));
            }
        }
    }
    let joiner = if rules.match_any { " OR " } else { " AND " };
    (
        format!("deleted_at IS NULL AND ({})", clauses.join(joiner)),
        params,
    )
}

fn parse_rules(json: &str) -> AppResult<SmartRules> {
    serde_json::from_str(json).map_err(|_| AppError::Conflict("invalid smart folder rules".into()))
}

/// Every saved rule set, in sidebar order. Shared by the command and the agent
/// API.
pub(crate) fn all_smart_folders_in(conn: &rusqlite::Connection) -> AppResult<Vec<SmartFolder>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, rules, position FROM smart_folders
         ORDER BY position, created_at",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? as u32,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    // Unparseable rules (edited by hand / newer app) are skipped, not fatal.
    Ok(rows
        .into_iter()
        .filter_map(
            |(id, name, rules_json, position)| match parse_rules(&rules_json) {
                Ok(rules) => Some(SmartFolder {
                    id,
                    name,
                    rules,
                    position,
                }),
                Err(_) => {
                    log::warn!("skipping smart folder {id}: unparseable rules");
                    None
                }
            },
        )
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn list_smart_folders(state: tauri::State<'_, AppState>) -> AppResult<Vec<SmartFolder>> {
    let library = state.current_library()?;
    library.read(all_smart_folders_in).await
}

/// Save a rule set as a live query. Shared by the command and the agent API —
/// this is how an agent turns "these should be grouped" into something durable
/// instead of a one-off pass.
pub(crate) fn create_smart_folder_in(
    conn: &rusqlite::Connection,
    name: &str,
    rules: SmartRules,
) -> AppResult<SmartFolder> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Conflict("smart folder name is empty".into()));
    }
    let folder = SmartFolder {
        id: new_id(),
        name: trimmed,
        rules,
        position: 0,
    };
    let json = serde_json::to_string(&folder.rules)?;
    conn.execute(
        "INSERT INTO smart_folders (id, name, rules, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        rusqlite::params![folder.id, folder.name, json, now_ms()],
    )?;
    Ok(folder)
}

#[tauri::command]
#[specta::specta]
pub async fn create_smart_folder(
    name: String,
    rules: SmartRules,
    state: tauri::State<'_, AppState>,
) -> AppResult<SmartFolder> {
    let library = state.current_library()?;
    library
        .write(move |conn| create_smart_folder_in(conn, &name, rules))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_smart_folder(
    id: String,
    name: Option<String>,
    rules: Option<SmartRules>,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    let library = state.current_library()?;
    let rules_json = match &rules {
        Some(rules) => Some(serde_json::to_string(rules)?),
        None => None,
    };
    library
        .write(move |conn| {
            if let Some(name) = name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
                conn.execute(
                    "UPDATE smart_folders SET name = ?2, updated_at = ?3 WHERE id = ?1",
                    rusqlite::params![id, name, now_ms()],
                )?;
            }
            if let Some(json) = &rules_json {
                conn.execute(
                    "UPDATE smart_folders SET rules = ?2, updated_at = ?3 WHERE id = ?1",
                    rusqlite::params![id, json, now_ms()],
                )?;
            }
            Ok(())
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_smart_folder(id: String, state: tauri::State<'_, AppState>) -> AppResult<()> {
    let library = state.current_library()?;
    library
        .write(move |conn| {
            conn.execute("DELETE FROM smart_folders WHERE id = ?1", [id.as_str()])?;
            Ok(())
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().expect("mem db");
        crate::db::apply_pragmas(&conn).expect("pragmas");
        crate::db::migrations::migrate(&mut conn).expect("migrate");
        conn.execute_batch(
            "INSERT INTO assets (id, name, ext, size, hash_blake3, rel_path, rating, hue, imported_at, updated_at)
             VALUES
               ('a0000000000000000001', 'sunset photo', 'jpg', 1, 'h1', 'assets/a0/1.jpg', 5, 0, 1000, 1000),
               ('a0000000000000000002', 'logo draft',   'svg', 1, 'h2', 'assets/a0/2.svg', 0, 7, 2000, 2000),
               ('a0000000000000000003', 'notes',        'txt', 1, 'h3', 'assets/a0/3.txt', 3, NULL, 3000, 3000);
             UPDATE assets SET deleted_at = 99 WHERE id = 'a0000000000000000003';",
        )
        .expect("seed");
        conn
    }

    fn count(conn: &rusqlite::Connection, rules: &SmartRules) -> i64 {
        let (predicate, params) = rules_to_predicate(rules);
        conn.query_row(
            &format!("SELECT COUNT(*) FROM assets WHERE {predicate}"),
            rusqlite::params_from_iter(params.iter()),
            |row| row.get(0),
        )
        .expect("count")
    }

    #[test]
    fn empty_rules_match_all_alive() {
        let conn = test_conn();
        let rules = SmartRules {
            match_any: false,
            conditions: vec![],
        };
        assert_eq!(count(&conn, &rules), 2); // trashed row excluded
    }

    #[test]
    fn all_mode_intersects_conditions() {
        let conn = test_conn();
        let rules = SmartRules {
            match_any: false,
            conditions: vec![
                SmartCondition::Ext {
                    values: vec!["JPG ".into()], // normalized: trim + lowercase
                },
                SmartCondition::RatingAtLeast { min: 4 },
            ],
        };
        assert_eq!(count(&conn, &rules), 1);
        let rules = SmartRules {
            match_any: false,
            conditions: vec![
                SmartCondition::Ext {
                    values: vec!["jpg".into()],
                },
                SmartCondition::Hue { value: 7 }, // jpg row is hue 0 → no hit
            ],
        };
        assert_eq!(count(&conn, &rules), 0);
    }

    #[test]
    fn any_mode_unions_conditions() {
        let conn = test_conn();
        let rules = SmartRules {
            match_any: true,
            conditions: vec![
                SmartCondition::Hue { value: 7 },
                SmartCondition::NameContains {
                    value: "sunset".into(),
                },
            ],
        };
        assert_eq!(count(&conn, &rules), 2);
    }

    #[test]
    fn like_wildcards_are_escaped() {
        let conn = test_conn();
        let rules = SmartRules {
            match_any: false,
            conditions: vec![SmartCondition::NameContains {
                value: "%".into(), // literal percent must match nothing here
            }],
        };
        assert_eq!(count(&conn, &rules), 0);
    }

    #[test]
    fn empty_ext_list_matches_nothing() {
        let conn = test_conn();
        let rules = SmartRules {
            match_any: false,
            conditions: vec![SmartCondition::Ext { values: vec![] }],
        };
        assert_eq!(count(&conn, &rules), 0);
    }

    #[test]
    fn media_kind_matches_by_classification() {
        let conn = test_conn();
        let by_kind = |value| SmartRules {
            match_any: false,
            conditions: vec![SmartCondition::MediaKind { value }],
        };
        // jpg + svg rows are images; the txt row is a document but trashed.
        assert_eq!(count(&conn, &by_kind(MediaKindValue::Image)), 2);
        assert_eq!(count(&conn, &by_kind(MediaKindValue::Video)), 0);
        assert_eq!(count(&conn, &by_kind(MediaKindValue::Document)), 0);
    }

    #[test]
    fn media_kind_lists_are_lowercase_and_disjoint() {
        // The SQL compares LOWER(ext) against these literals, so a stray
        // uppercase entry would silently never match.
        let kinds = [
            MediaKindValue::Image,
            MediaKindValue::Video,
            MediaKindValue::Audio,
            MediaKindValue::Document,
        ];
        let mut seen = std::collections::HashSet::new();
        for kind in kinds {
            for ext in exts_for_kind(kind) {
                assert_eq!(*ext, ext.to_lowercase(), "{ext} must be lowercase");
                assert!(seen.insert(*ext), "{ext} appears in two kinds");
            }
        }
    }

    #[test]
    fn media_kind_round_trips_through_rules_json() {
        // Rules persist as JSON; the wire tag is what old rows will hold
        // forever, so pin it.
        let rules = SmartRules {
            match_any: false,
            conditions: vec![SmartCondition::MediaKind {
                value: MediaKindValue::Image,
            }],
        };
        let json = serde_json::to_string(&rules).expect("serialize");
        assert!(json.contains(r#""field":"media_kind""#), "{json}");
        assert!(json.contains(r#""value":"image""#), "{json}");
        let parsed = parse_rules(&json).expect("parse");
        assert_eq!(parsed.conditions.len(), 1);
    }
}
