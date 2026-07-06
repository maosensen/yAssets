//! The library: a self-contained folder anywhere on disk holding the SQLite
//! catalog, managed asset files, and generated thumbnails.
//!
//! ```text
//! MyLibrary/
//! ├── library.json          # metadata readable without opening the DB
//! ├── library.db            # SQLite catalog (WAL)
//! ├── assets/<shard>/<id>.<ext>
//! └── thumbs/<shard>/<id>.webp
//! ```
//!
//! Files are stored under generated ids (original names live in the DB), so
//! name collisions are impossible and media-protocol paths derive from the id
//! with zero DB lookups. `<shard>` is the first two id chars (36² buckets).
//!
//! Concurrency: one writer connection behind a `Mutex`, a small lazily-grown
//! reader pool, WAL so readers never block the writer. All DB access goes
//! through [`Library::read`]/[`Library::write`], which run on blocking
//! threads — commands stay `async` and never hold a lock across an await.

pub mod recent;
pub mod watch;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::{AppError, AppResult};

pub const LIBRARY_JSON: &str = "library.json";
pub const DB_FILE: &str = "library.db";
pub const ASSETS_DIR: &str = "assets";
pub const THUMBS_DIR: &str = "thumbs";

/// Reader connections kept warm. Enough for grid + inspector + stats racing;
/// extra concurrent reads just open a short-lived connection.
const MAX_POOLED_READERS: usize = 3;

/// Lowercase-only id alphabet. macOS APFS is case-insensitive, so a
/// mixed-case alphabet would let `Ab…` and `ab…` collide on disk.
pub const ID_ALPHABET: [char; 36] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i',
    'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
];

/// New 20-char id for assets / folders / jobs (~103 bits of entropy).
pub fn new_id() -> String {
    nanoid::nanoid!(20, &ID_ALPHABET)
}

/// Relative storage path for an asset file: `assets/<shard>/<id>[.<ext>]`.
/// Extensionless files store as the bare id.
pub fn asset_rel_path(id: &str, ext: &str) -> String {
    if ext.is_empty() {
        format!("{ASSETS_DIR}/{}/{id}", &id[..2])
    } else {
        format!("{ASSETS_DIR}/{}/{id}.{ext}", &id[..2])
    }
}

/// Current unix time in milliseconds (DB timestamp convention).
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Run a blocking closure off the async runtime and surface panics/join
/// failures as `Internal`. Shared by `Library::read`/`write` and commands
/// that do filesystem work.
pub async fn run_blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|err| {
            log::error!("blocking task failed to join: {err}");
            AppError::Internal
        })?
}

/// Contents of `library.json` — readable without opening the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryFileInfo {
    pub library_id: String,
    pub name: String,
    /// Fast open-time rejection when the library is newer than this build;
    /// the DB's `user_version` remains authoritative.
    pub schema_version: u32,
    /// Unix ms.
    pub created_at: i64,
    /// App version that last wrote this file (diagnostics only).
    pub app_version: String,
}

/// Library descriptor crossing the IPC boundary.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct LibraryInfo {
    pub path: String,
    pub name: String,
    pub library_id: String,
    /// Unix ms.
    pub created_at: f64,
}

#[derive(Debug)]
pub struct Library {
    root: PathBuf,
    db_path: PathBuf,
    file_info: LibraryFileInfo,
    writer: Mutex<Connection>,
    readers: Mutex<Vec<Connection>>,
}

impl Library {
    /// Create a new library at `root` (must not exist, or be an empty
    /// directory — dotfiles like `.DS_Store` are tolerated).
    pub fn create(root: &Path) -> AppResult<Self> {
        if root.exists() {
            if !root.is_dir() {
                return Err(AppError::Conflict(format!(
                    "target exists and is not a directory: {}",
                    root.display()
                )));
            }
            let has_visible_entries = std::fs::read_dir(root)?
                .filter_map(Result::ok)
                .any(|entry| !entry.file_name().to_string_lossy().starts_with('.'));
            if has_visible_entries {
                return Err(AppError::Conflict(format!(
                    "target directory is not empty: {}",
                    root.display()
                )));
            }
        }
        std::fs::create_dir_all(root.join(ASSETS_DIR))?;
        std::fs::create_dir_all(root.join(THUMBS_DIR))?;

        let file_info = LibraryFileInfo {
            library_id: new_id(),
            name: folder_display_name(root),
            schema_version: db::migrations::latest_version(),
            created_at: now_ms(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        };
        write_library_json(root, &file_info)?;

        let db_path = root.join(DB_FILE);
        let mut writer = db::open_file_connection(&db_path)?;
        db::migrations::migrate(&mut writer)?;

        log::info!("library created: {}", root.display());
        Ok(Self {
            root: root.to_path_buf(),
            db_path,
            file_info,
            writer: Mutex::new(writer),
            readers: Mutex::new(Vec::new()),
        })
    }

    /// Open an existing library, migrating its schema forward if needed.
    pub fn open(root: &Path) -> AppResult<Self> {
        if !root.is_dir() {
            return Err(AppError::NotFound(format!(
                "library folder not found: {}",
                root.display()
            )));
        }
        let json_path = root.join(LIBRARY_JSON);
        if !json_path.is_file() {
            return Err(AppError::LibraryIncompatible(format!(
                "not a yAssets library (missing {LIBRARY_JSON}): {}",
                root.display()
            )));
        }

        let mut file_info: LibraryFileInfo = serde_json::from_slice(&std::fs::read(&json_path)?)?;
        let latest = db::migrations::latest_version();
        if file_info.schema_version > latest {
            return Err(AppError::LibraryIncompatible(format!(
                "library schema v{} is newer than this app supports (v{latest})",
                file_info.schema_version
            )));
        }

        let db_path = root.join(DB_FILE);
        let mut writer = db::open_file_connection(&db_path)?;
        db::migrations::migrate(&mut writer)?;

        // Keep the fast-rejection marker in sync after a successful migration.
        if file_info.schema_version != latest {
            file_info.schema_version = latest;
            file_info.app_version = env!("CARGO_PKG_VERSION").to_string();
            write_library_json(root, &file_info)?;
        }

        // Self-heal missing media dirs (a user may have tidied an empty one).
        std::fs::create_dir_all(root.join(ASSETS_DIR))?;
        std::fs::create_dir_all(root.join(THUMBS_DIR))?;

        log::info!("library opened: {}", root.display());
        Ok(Self {
            root: root.to_path_buf(),
            db_path,
            file_info,
            writer: Mutex::new(writer),
            readers: Mutex::new(Vec::new()),
        })
    }

    pub fn info(&self) -> LibraryInfo {
        LibraryInfo {
            path: self.root.to_string_lossy().into_owned(),
            name: self.file_info.name.clone(),
            library_id: self.file_info.library_id.clone(),
            created_at: self.file_info.created_at as f64,
        }
    }

    // Consumed by the import pipeline from M2 on.
    #[allow(dead_code)]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// `<root>/thumbs/<shard>/<id>.webp` — derivable without a DB lookup.
    pub fn thumb_path(&self, id: &str) -> PathBuf {
        self.root
            .join(THUMBS_DIR)
            .join(&id[..2])
            .join(format!("{id}.webp"))
    }

    /// Resolve a DB `rel_path` (e.g. `assets/ab/<id>.png`) against the root.
    // Consumed by the media protocol's /file route from M3 on.
    #[allow(dead_code)]
    pub fn resolve_rel(&self, rel_path: &str) -> PathBuf {
        self.root.join(rel_path)
    }

    /// Run a read-only query on a pooled reader connection (blocking thread).
    pub async fn read<T: Send + 'static>(
        self: &Arc<Self>,
        f: impl FnOnce(&Connection) -> AppResult<T> + Send + 'static,
    ) -> AppResult<T> {
        let lib = Arc::clone(self);
        run_blocking(move || lib.with_reader(f)).await
    }

    /// Run a statement/transaction on the single writer connection
    /// (blocking thread). Keep closures small — micro-transactions.
    // Consumed by asset/folder mutations from M3 on.
    #[allow(dead_code)]
    pub async fn write<T: Send + 'static>(
        self: &Arc<Self>,
        f: impl FnOnce(&mut Connection) -> AppResult<T> + Send + 'static,
    ) -> AppResult<T> {
        let lib = Arc::clone(self);
        run_blocking(move || lib.with_writer(f)).await
    }

    /// Synchronous reader access for code already running on a worker thread
    /// (the import pipeline's rayon workers). Async commands use [`Self::read`].
    pub fn with_reader<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self.checkout_reader()?;
        let result = f(&conn);
        self.return_reader(conn);
        result
    }

    /// Synchronous writer access for worker threads. Micro-transactions only —
    /// the writer lock is held for the closure's whole duration.
    pub fn with_writer<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut conn = self.writer.lock().map_err(|_| {
            log::error!("writer mutex poisoned");
            AppError::Internal
        })?;
        f(&mut conn)
    }

    fn checkout_reader(&self) -> AppResult<Connection> {
        if let Ok(mut pool) = self.readers.lock() {
            if let Some(conn) = pool.pop() {
                return Ok(conn);
            }
        }
        db::open_file_connection(&self.db_path)
    }

    fn return_reader(&self, conn: Connection) {
        if let Ok(mut pool) = self.readers.lock() {
            if pool.len() < MAX_POOLED_READERS {
                pool.push(conn);
            }
        }
    }

    /// Size of the database file (excluding the WAL) in bytes.
    pub fn db_size_bytes(&self) -> u64 {
        std::fs::metadata(&self.db_path)
            .map(|m| m.len())
            .unwrap_or(0)
    }

    /// Files under `assets/` and `thumbs/` with no live DB row — returned as
    /// absolute paths (asset files, thumbnail files). Read-only. A caller that
    /// DELETES the results must ensure no import is in flight: a mid-import file
    /// exists on disk before its row commits and would look orphaned.
    pub fn find_orphans(&self) -> (Vec<PathBuf>, Vec<PathBuf>) {
        use std::collections::HashSet;
        let catalog = self
            .with_reader(|conn| {
                let mut stmt = conn.prepare("SELECT id, rel_path FROM assets")?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .unwrap_or_default();
        let ids: HashSet<&str> = catalog.iter().map(|(id, _)| id.as_str()).collect();
        let rels: HashSet<&str> = catalog.iter().map(|(_, rel)| rel.as_str()).collect();

        let mut orphan_assets = Vec::new();
        for entry in walkdir::WalkDir::new(self.root.join(ASSETS_DIR))
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .filter(|e| !crate::import::is_junk(e.file_name()))
        {
            let rel = entry
                .path()
                .strip_prefix(&self.root)
                .map(|p| p.to_string_lossy().into_owned())
                // DB rel_paths use forward slashes (asset_rel_path); normalize the
                // OS-native separator so Windows backslashes still match — else
                // EVERY asset file looks orphaned and cleanup would nuke the library.
                .map(|rel| rel.replace(std::path::MAIN_SEPARATOR, "/"))
                .unwrap_or_default();
            if !rels.contains(rel.as_str()) {
                orphan_assets.push(entry.into_path());
            }
        }
        let mut orphan_thumbs = Vec::new();
        for entry in walkdir::WalkDir::new(self.root.join(THUMBS_DIR))
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .filter(|e| !crate::import::is_junk(e.file_name()))
        {
            let stem = entry
                .path()
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            if !ids.contains(stem.as_str()) {
                orphan_thumbs.push(entry.into_path());
            }
        }
        (orphan_assets, orphan_thumbs)
    }

    /// `PRAGMA integrity_check` — true when the database reports "ok".
    pub fn integrity_check(&self) -> AppResult<bool> {
        self.with_reader(|conn| {
            let result: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
            Ok(result == "ok")
        })
    }

    /// Rebuild the database to reclaim free pages, returning bytes reclaimed.
    /// Serializes on the writer lock, drops idle pooled readers, folds the WAL,
    /// then VACUUMs (which can't run inside a transaction). A concurrent read
    /// snapshot can make SQLite report busy — surfaced as a retryable Conflict.
    pub fn vacuum(&self) -> AppResult<u64> {
        let before = self.db_size_bytes();
        let conn = self.writer.lock().map_err(|_| {
            log::error!("writer mutex poisoned");
            AppError::Internal
        })?;
        if let Ok(mut pool) = self.readers.lock() {
            pool.clear();
        }
        db::checkpoint_truncate(&conn);
        conn.execute_batch("VACUUM").map_err(|err| {
            log::warn!("vacuum failed: {err}");
            AppError::Conflict("database is busy; try again".into())
        })?;
        db::checkpoint_truncate(&conn);
        Ok(before.saturating_sub(self.db_size_bytes()))
    }
}

impl Drop for Library {
    fn drop(&mut self) {
        // Drop readers first — TRUNCATE checkpointing needs no other
        // connections on the database.
        if let Ok(mut pool) = self.readers.lock() {
            pool.clear();
        }
        if let Ok(conn) = self.writer.lock() {
            db::checkpoint_truncate(&conn);
        }
        log::info!("library closed: {}", self.root.display());
    }
}

/// Background, log-only sweep for orphan files: id-named files under
/// `assets/`/`thumbs/` with no matching DB row. These are the harmless
/// residue of crashed imports / interrupted purges — never auto-deleted in
/// phase 1, just surfaced in the log for diagnostics.
pub fn spawn_orphan_sweep(library: Arc<Library>) {
    tauri::async_runtime::spawn_blocking(move || {
        let (orphan_assets, orphan_thumbs) = library.find_orphans();
        if !orphan_assets.is_empty() || !orphan_thumbs.is_empty() {
            log::info!(
                "orphan sweep ({}): {} asset file(s), {} thumbnail(s) without DB rows (log-only; clean from Preferences ▸ Maintenance)",
                library.root().display(),
                orphan_assets.len(),
                orphan_thumbs.len(),
            );
        }
    });
}

/// Background backfill for assets missing a thumbnail or color analysis —
/// e.g. existing libraries after the SVG-thumbnail / color-extraction
/// features landed. Idempotent, best-effort, log-only; runs on library open.
pub fn spawn_backfill(library: Arc<Library>) {
    tauri::async_runtime::spawn_blocking(move || {
        let pending = library.with_reader(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, ext, rel_path FROM assets
                 WHERE deleted_at IS NULL
                   AND (has_thumb = 0 OR hue IS NULL OR dhash IS NULL)",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        });
        let Ok(pending) = pending else { return };
        let todo: Vec<_> = pending
            .into_iter()
            .filter(|(_, ext, _)| crate::import::thumbs::is_thumbable_ext(ext))
            .collect();
        if todo.is_empty() {
            return;
        }
        log::info!("backfill: {} asset(s) need thumbnail/color", todo.len());

        let mut done = 0u32;
        for (id, ext, rel_path) in todo {
            let src = library.resolve_rel(&rel_path);
            match crate::import::thumbs::generate(&src, &library.thumb_path(&id), &ext) {
                Ok(outcome) => {
                    let _ = library.with_writer(|conn| {
                        conn.execute(
                            "UPDATE assets
                             SET has_thumb = 1, width = ?2, height = ?3,
                                 hue = ?4, palette = ?5, dhash = ?6
                             WHERE id = ?1",
                            rusqlite::params![
                                id,
                                outcome.width,
                                outcome.height,
                                outcome.hue,
                                outcome.palette,
                                outcome.dhash,
                            ],
                        )?;
                        Ok(())
                    });
                    done += 1;
                }
                Err(err) => log::warn!("backfill failed for {id}: {err}"),
            }
        }
        log::info!("backfill: completed {done} asset(s)");
    });
}

fn folder_display_name(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Library".to_string())
}

fn write_library_json(root: &Path, info: &LibraryFileInfo) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(info)?;
    std::fs::write(root.join(LIBRARY_JSON), bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_id_is_20_lowercase() {
        let id = new_id();
        assert_eq!(id.len(), 20);
        assert!(id
            .bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase()));
    }

    #[test]
    fn create_lays_out_the_folder() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let root = tmp.path().join("MyLib");
        let lib = Library::create(&root).expect("create");

        assert!(root.join(LIBRARY_JSON).is_file());
        assert!(root.join(DB_FILE).is_file());
        assert!(root.join(ASSETS_DIR).is_dir());
        assert!(root.join(THUMBS_DIR).is_dir());
        assert_eq!(lib.info().name, "MyLib");
    }

    #[test]
    fn create_rejects_non_empty_dir() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        std::fs::write(tmp.path().join("occupied.txt"), b"x").expect("seed file");
        let err = Library::create(tmp.path()).expect_err("must reject");
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[test]
    fn create_tolerates_dotfiles_only() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        std::fs::write(tmp.path().join(".DS_Store"), b"x").expect("seed dotfile");
        Library::create(tmp.path()).expect("create over dotfiles");
    }

    #[test]
    fn open_round_trips_create() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let root = tmp.path().join("Lib");
        let created_info = Library::create(&root).expect("create").info();
        // Drop happened — WAL checkpointed. Reopen.
        let reopened = Library::open(&root).expect("open");
        assert_eq!(reopened.info().library_id, created_info.library_id);
        assert_eq!(reopened.info().name, created_info.name);
    }

    #[test]
    fn open_rejects_plain_folder() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let err = Library::open(tmp.path()).expect_err("must reject");
        assert!(matches!(err, AppError::LibraryIncompatible(_)));
    }

    #[test]
    fn open_rejects_missing_folder() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let err = Library::open(&tmp.path().join("nope")).expect_err("must reject");
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn open_rejects_newer_schema() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let root = tmp.path().join("Lib");
        {
            Library::create(&root).expect("create");
        }
        // Forge a future schema_version in library.json.
        let json_path = root.join(LIBRARY_JSON);
        let mut info: LibraryFileInfo =
            serde_json::from_slice(&std::fs::read(&json_path).expect("read")).expect("parse");
        info.schema_version = 9999;
        std::fs::write(&json_path, serde_json::to_vec_pretty(&info).expect("ser")).expect("write");

        let err = Library::open(&root).expect_err("must reject");
        assert!(matches!(err, AppError::LibraryIncompatible(_)));
    }

    #[test]
    fn thumb_path_is_sharded_under_root() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let root = tmp.path().join("Lib");
        let lib = Library::create(&root).expect("create");
        let path = lib.thumb_path("ab12345678cd12345678");
        assert_eq!(
            path,
            root.join("thumbs")
                .join("ab")
                .join("ab12345678cd12345678.webp")
        );
    }
}
