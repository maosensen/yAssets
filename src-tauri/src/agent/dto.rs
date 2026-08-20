//! Wire types for the agent surface.
//!
//! Deliberately **not** the internal command types. Two reasons:
//!
//! 1. Ergonomics — `AssetListQuery` makes `scope`/`sort`/`dir` mandatory and
//!    spells its enums in PascalCase (`"ImportedAt"`). A model writing JSON by
//!    hand gets it wrong. Here every field is optional with a sane default and
//!    the vocabulary is lowercase.
//! 2. Redaction — the internal types carry absolute host paths
//!    (`AssetDetail::src_path`, `LibraryInfo::path`). The architecture keeps
//!    path resolution inside Rust; that invariant applies to agents exactly as
//!    it does to the webview, so those fields never appear on this boundary.
//!
//! Page sizes are also much smaller than the internal ceiling (50 000 rows):
//! an agent's context is the scarce resource, so the cap is 200 with a default
//! of 50 and an explicit `nextOffset` to page with.

use serde::{Deserialize, Serialize};

use crate::commands::assets::{
    AssetDetail, AssetListQuery, AssetScope, AssetSummary, SortDir, SortKey,
};
use crate::commands::folders::{Folder, FolderStats};
use crate::commands::library::LibraryStats;
use crate::commands::smart_folders::SmartFolder;
use crate::commands::tags::Tag;
use crate::error::{AppError, AppResult};

pub const DEFAULT_LIMIT: u32 = 50;
pub const MAX_LIMIT: u32 = 200;

/// Most ids a single mutating call may touch. Not a performance limit — a blast
/// radius limit. An agent that wants to retag 5 000 assets has to page, which
/// gives the user 10 chances to notice instead of 1.
pub const MAX_BATCH: usize = 500;

/// Reject a batch before anything is written. Empty is a mistake worth naming
/// (an agent that computed an empty id list usually meant to filter differently).
pub fn check_batch(asset_ids: &[String]) -> AppResult<()> {
    if asset_ids.is_empty() {
        return Err(AppError::Conflict("assetIds must not be empty".into()));
    }
    if asset_ids.len() > MAX_BATCH {
        return Err(AppError::Conflict(format!(
            "{} ids in one call, the limit is {MAX_BATCH} — page through larger sets",
            asset_ids.len()
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------- requests ---

/// A scope either names itself (`"untagged"`) or carries an id/number
/// (`{"folder": "…"}`). Untagged so both spellings work in one field.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ScopeSpec {
    Named(String),
    Keyed(KeyedScope),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyedScope {
    Folder(String),
    Tag(String),
    SmartFolder(String),
    RecentDays(u32),
    Hue(u8),
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortSpec {
    ImportedAt,
    Name,
    Size,
    Rating,
    UpdatedAt,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirSpec {
    Asc,
    Desc,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchRequest {
    /// Full-text over name + note. Absent/empty = no text filter.
    pub query: Option<String>,
    pub scope: Option<ScopeSpec>,
    pub rating_min: Option<u8>,
    /// Lowercase extensions, ANY-of.
    pub ext: Option<Vec<String>>,
    /// Tag ids, ANY-of. Stacks on top of `scope`.
    pub tags: Option<Vec<String>>,
    pub sort: Option<SortSpec>,
    pub dir: Option<DirSpec>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    /// Opt-in joins: `"tags"`, `"folders"`. Unknown values are ignored so a
    /// hopeful guess degrades instead of failing the request.
    pub include: Option<Vec<String>>,
}

/// Which extra joins a search asked for.
#[derive(Debug, Default, Clone, Copy)]
pub struct Includes {
    pub tags: bool,
    pub folders: bool,
}

impl SearchRequest {
    pub fn includes(&self) -> Includes {
        let mut includes = Includes::default();
        for name in self.include.iter().flatten() {
            match name.trim().to_ascii_lowercase().as_str() {
                "tags" => includes.tags = true,
                "folders" | "folder_ids" | "folderids" => includes.folders = true,
                _ => {}
            }
        }
        includes
    }

    pub fn effective_offset(&self) -> u32 {
        self.offset.unwrap_or(0)
    }

    pub fn effective_limit(&self) -> u32 {
        self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
    }

    /// Translate into the internal query. Rejects unknown scope/rating values
    /// with a message that names the accepted vocabulary — the agent's only
    /// feedback channel is the error string, so it has to be actionable.
    pub fn to_query(&self) -> AppResult<AssetListQuery> {
        if let Some(rating) = self.rating_min {
            if rating > 5 {
                return Err(AppError::Conflict("ratingMin must be 0-5".into()));
            }
        }
        Ok(AssetListQuery {
            scope: self
                .scope
                .as_ref()
                .map(scope_of)
                .transpose()?
                .unwrap_or(AssetScope::All),
            search: self.query.clone(),
            rating_min: self.rating_min,
            types: self.ext.clone(),
            tag_ids: self.tags.clone(),
            sort: match self.sort.unwrap_or(SortSpec::ImportedAt) {
                SortSpec::ImportedAt => SortKey::ImportedAt,
                SortSpec::Name => SortKey::Name,
                SortSpec::Size => SortKey::Size,
                SortSpec::Rating => SortKey::Rating,
                SortSpec::UpdatedAt => SortKey::UpdatedAt,
            },
            dir: match self.dir.unwrap_or(DirSpec::Desc) {
                DirSpec::Asc => SortDir::Asc,
                DirSpec::Desc => SortDir::Desc,
            },
            // Keyset paging needs a cursor built from the previous page's last
            // row; offset paging is what an agent can actually drive.
            cursor: None,
            offset: Some(self.effective_offset()),
            limit: Some(self.effective_limit()),
        })
    }
}

fn scope_of(spec: &ScopeSpec) -> AppResult<AssetScope> {
    match spec {
        ScopeSpec::Named(name) => match name.trim().to_ascii_lowercase().as_str() {
            "all" => Ok(AssetScope::All),
            "uncategorized" => Ok(AssetScope::Uncategorized),
            "untagged" => Ok(AssetScope::Untagged),
            "trash" => Ok(AssetScope::Trash),
            other => Err(AppError::Conflict(format!(
                "unknown scope {other:?} — use all | uncategorized | untagged | trash, \
                 or an object like {{\"folder\": \"<id>\"}}"
            ))),
        },
        ScopeSpec::Keyed(keyed) => Ok(match keyed {
            KeyedScope::Folder(folder_id) => AssetScope::Folder {
                folder_id: folder_id.clone(),
            },
            KeyedScope::Tag(tag_id) => AssetScope::Tag {
                tag_id: tag_id.clone(),
            },
            KeyedScope::SmartFolder(smart_folder_id) => AssetScope::SmartFolder {
                smart_folder_id: smart_folder_id.clone(),
            },
            KeyedScope::RecentDays(days) => AssetScope::Recent { days: *days },
            KeyedScope::Hue(hue) => AssetScope::Color { hue: *hue },
        }),
    }
}

// ----------------------------------------------------------- write requests ---

/// Batch shape shared by trash/restore. `dryRun` reports the target set without
/// writing — the tool descriptions ask for a preview pass first.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AssetIdsRequest {
    pub asset_ids: Vec<String>,
    pub dry_run: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TagAssetsRequest {
    pub asset_ids: Vec<String>,
    /// Tag *names*. Created on demand (create-or-get by case-insensitive name),
    /// so an agent can propose vocabulary without a separate round trip.
    pub tags: Vec<String>,
    /// Existing tag ids, for when the agent already has them from `list_tags`.
    /// Combined with `tags` if both are given.
    pub tag_ids: Vec<String>,
    pub dry_run: bool,
}

impl TagAssetsRequest {
    pub fn has_tags(&self) -> bool {
        self.tags.iter().any(|name| !name.trim().is_empty()) || !self.tag_ids.is_empty()
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FolderAssetsRequest {
    pub asset_ids: Vec<String>,
    pub folder_id: String,
    pub dry_run: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RateAssetsRequest {
    pub asset_ids: Vec<String>,
    pub rating: u8,
    pub dry_run: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateTagRequest {
    pub name: String,
    pub color: Option<String>,
}

/// Single-asset metadata edit. Absent fields stay untouched; `url: ""` clears
/// the link (same semantics as the inspector).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateAssetRequest {
    pub id: String,
    pub name: Option<String>,
    pub note: Option<String>,
    pub rating: Option<u8>,
    pub url: Option<String>,
}

impl UpdateAssetRequest {
    pub fn to_patch(&self) -> crate::commands::assets::AssetPatch {
        crate::commands::assets::AssetPatch {
            name: self.name.clone(),
            note: self.note.clone(),
            rating: self.rating,
            url: self.url.clone(),
        }
    }

    pub fn touches_anything(&self) -> bool {
        self.name.is_some() || self.note.is_some() || self.rating.is_some() || self.url.is_some()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSmartFolderRequest {
    pub name: String,
    pub rules: crate::commands::smart_folders::SmartRules,
}

/// The answer to every batch write.
///
/// `targets` and `affected` differ on purpose: re-tagging an already-tagged
/// asset resolves as a target but changes no row. Reporting only one number
/// would make a correct no-op look like a failure.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    /// True when nothing was written.
    pub dry_run: bool,
    /// Ids that resolved to a real asset in the relevant state.
    pub targets: u32,
    /// Rows actually changed. Always 0 on a dry run.
    pub affected: u32,
    /// A few target names so the caller can eyeball the set before committing.
    pub sample: Vec<String>,
}

/// One recorded agent write (schema v11 `agent_audit`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRow {
    pub at: i64,
    pub tool: String,
    pub params: serde_json::Value,
    pub affected: u32,
    pub ok: bool,
}

// --------------------------------------------------------------- responses ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRow {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRowWithCount {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub asset_count: u32,
}

/// One compact search hit. Optional fields are omitted rather than sent as
/// `null` — over a few hundred rows that is a meaningful chunk of context.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRow {
    pub id: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub rating: u8,
    /// `"file"` or `"link"` (a bookmark).
    pub kind: String,
    pub has_thumb: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub imported_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<TagRow>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_ids: Option<Vec<String>>,
}

impl AssetRow {
    pub fn from_summary(summary: AssetSummary) -> Self {
        Self {
            id: summary.id,
            name: summary.name,
            ext: summary.ext,
            size: summary.size as u64,
            width: summary.width,
            height: summary.height,
            rating: summary.rating,
            kind: summary.kind,
            has_thumb: summary.has_thumb,
            url: summary.url,
            imported_at: summary.imported_at as i64,
            duration_ms: summary.duration_ms.map(|ms| ms as i64),
            tags: None,
            folder_ids: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    /// Rows matching the filters, ignoring paging.
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
    /// Pass back as `offset` for the next page; absent when this was the last.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<u32>,
    pub items: Vec<AssetRow>,
}

impl SearchResponse {
    pub fn new(total: u32, offset: u32, limit: u32, items: Vec<AssetRow>) -> Self {
        let consumed = offset.saturating_add(items.len() as u32);
        Self {
            total,
            offset,
            limit,
            next_offset: (consumed < total && !items.is_empty()).then_some(consumed),
            items,
        }
    }
}

/// Detail view. `srcFilename` is the *basename* of the import-time source path:
/// useful provenance, no directory structure — see the module note on paths.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDetailRow {
    pub id: String,
    pub name: String,
    pub ext: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub rating: u8,
    pub kind: String,
    pub has_thumb: bool,
    pub note: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src_filename: Option<String>,
    pub folder_ids: Vec<String>,
    pub tags: Vec<TagRow>,
    pub palette: Vec<String>,
    pub imported_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<i64>,
}

impl AssetDetailRow {
    pub fn from_detail(detail: AssetDetail) -> Self {
        Self {
            id: detail.id,
            name: detail.name,
            ext: detail.ext,
            mime: detail.mime,
            size: detail.size as u64,
            width: detail.width,
            height: detail.height,
            rating: detail.rating,
            kind: detail.kind,
            has_thumb: detail.has_thumb,
            note: detail.note,
            url: detail.url,
            src_filename: detail.src_path.as_deref().and_then(basename),
            folder_ids: detail.folder_ids,
            tags: detail
                .tags
                .into_iter()
                .map(|tag| TagRow {
                    id: tag.id,
                    name: tag.name,
                    color: tag.color,
                })
                .collect(),
            palette: detail.palette,
            imported_at: detail.imported_at as i64,
            updated_at: detail.updated_at as i64,
            deleted_at: detail.deleted_at.map(|ms| ms as i64),
        }
    }
}

/// Last path component of a host path, whatever the platform separator. Kept
/// as a pure helper so the redaction is unit-testable.
pub fn basename(path: &str) -> Option<String> {
    let name = path.rsplit(['/', '\\']).find(|part| !part.is_empty())?;
    Some(name.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRow {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub name: String,
    pub position: u32,
    pub asset_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

impl From<Folder> for FolderRow {
    fn from(folder: Folder) -> Self {
        Self {
            id: folder.id,
            parent_id: folder.parent_id,
            name: folder.name,
            position: folder.position,
            asset_count: folder.asset_count,
            description: folder.description,
            color: folder.color,
            icon: folder.icon,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStatsRow {
    pub item_count: u32,
    pub total_size: u64,
}

impl From<FolderStats> for FolderStatsRow {
    fn from(stats: FolderStats) -> Self {
        Self {
            item_count: stats.item_count,
            total_size: stats.total_size as u64,
        }
    }
}

impl From<Tag> for TagRowWithCount {
    fn from(tag: Tag) -> Self {
        Self {
            id: tag.id,
            name: tag.name,
            color: tag.color,
            asset_count: tag.asset_count,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartFolderRow {
    pub id: String,
    pub name: String,
    /// The saved rule set, verbatim — the internal shape is already agent-legible.
    /// `null` when this build cannot read them (a folder written by a newer
    /// version); the folder is still listed so an agent can see it exists and
    /// report it, but it must not try to reason about or rewrite the rules.
    pub rules: Option<crate::commands::smart_folders::SmartRules>,
}

impl From<SmartFolder> for SmartFolderRow {
    fn from(folder: SmartFolder) -> Self {
        Self {
            id: folder.id,
            name: folder.name,
            rules: folder.rules,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsRow {
    pub total: u32,
    pub uncategorized: u32,
    pub untagged: u32,
    pub trash: u32,
    pub total_size: u64,
}

impl From<LibraryStats> for StatsRow {
    fn from(stats: LibraryStats) -> Self {
        Self {
            total: stats.total,
            uncategorized: stats.uncategorized,
            untagged: stats.untagged,
            trash: stats.trash,
            total_size: stats.total_size as u64,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatesResponse {
    pub exact: Vec<Vec<AssetRow>>,
    pub visual: Vec<Vec<AssetRow>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> SearchRequest {
        serde_json::from_str(json).expect("parse")
    }

    #[test]
    fn an_empty_body_is_a_valid_search() {
        let req = parse("{}");
        let query = req.to_query().expect("query");
        assert!(matches!(query.scope, AssetScope::All));
        assert!(matches!(query.sort, SortKey::ImportedAt));
        assert!(matches!(query.dir, SortDir::Desc));
        assert_eq!(query.limit, Some(DEFAULT_LIMIT));
        assert_eq!(query.offset, Some(0));
    }

    #[test]
    fn scopes_accept_both_a_name_and_an_object() {
        assert!(matches!(
            parse(r#"{"scope":"untagged"}"#).to_query().unwrap().scope,
            AssetScope::Untagged
        ));
        assert!(matches!(
            parse(r#"{"scope":"TRASH"}"#).to_query().unwrap().scope,
            AssetScope::Trash
        ));
        let scope = parse(r#"{"scope":{"folder":"folder0000000000000a"}}"#)
            .to_query()
            .unwrap()
            .scope;
        match scope {
            AssetScope::Folder { folder_id } => assert_eq!(folder_id, "folder0000000000000a"),
            other => panic!("expected a folder scope, got {other:?}"),
        }
        assert!(matches!(
            parse(r#"{"scope":{"recentDays":7}}"#)
                .to_query()
                .unwrap()
                .scope,
            AssetScope::Recent { days: 7 }
        ));
    }

    #[test]
    fn an_unknown_scope_names_the_accepted_vocabulary() {
        let err = parse(r#"{"scope":"favourites"}"#).to_query().unwrap_err();
        let message = err.to_string();
        assert!(message.contains("favourites"), "{message}");
        assert!(message.contains("untagged"), "{message}");
    }

    #[test]
    fn limits_are_clamped_not_trusted() {
        assert_eq!(parse(r#"{"limit":100000}"#).effective_limit(), MAX_LIMIT);
        assert_eq!(parse(r#"{"limit":0}"#).effective_limit(), 1);
        assert_eq!(parse(r#"{"limit":25}"#).effective_limit(), 25);
    }

    #[test]
    fn rating_min_is_validated() {
        assert!(parse(r#"{"ratingMin":9}"#).to_query().is_err());
        assert!(parse(r#"{"ratingMin":5}"#).to_query().is_ok());
    }

    #[test]
    fn includes_ignore_unknown_names() {
        let includes = parse(r#"{"include":["tags","nope"]}"#).includes();
        assert!(includes.tags);
        assert!(!includes.folders);
        let both = parse(r#"{"include":["folders","TAGS"]}"#).includes();
        assert!(both.tags && both.folders);
    }

    #[test]
    fn next_offset_stops_at_the_end() {
        let rows = || {
            vec![AssetRow {
                id: "a".into(),
                name: "a".into(),
                ext: "png".into(),
                size: 1,
                width: None,
                height: None,
                rating: 0,
                kind: "file".into(),
                has_thumb: false,
                url: None,
                imported_at: 0,
                duration_ms: None,
                tags: None,
                folder_ids: None,
            }]
        };
        assert_eq!(SearchResponse::new(10, 0, 1, rows()).next_offset, Some(1));
        assert_eq!(SearchResponse::new(1, 0, 1, rows()).next_offset, None);
        // An empty page never advertises a next page, whatever `total` claims.
        assert_eq!(SearchResponse::new(10, 10, 1, vec![]).next_offset, None);
    }

    #[test]
    fn basename_strips_directories_on_both_separators() {
        assert_eq!(
            basename("/Users/x/Pictures/a.png").as_deref(),
            Some("a.png")
        );
        assert_eq!(
            basename(r"C:\Users\x\Pictures\a.png").as_deref(),
            Some("a.png")
        );
        assert_eq!(basename("a.png").as_deref(), Some("a.png"));
        assert_eq!(basename("/"), None);
        assert_eq!(basename(""), None);
    }
}
