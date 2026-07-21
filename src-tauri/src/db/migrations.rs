//! Versioned schema migrations, tracked via SQLite's `PRAGMA user_version`.
//!
//! `user_version == 0` means a fresh database; `user_version == MIGRATIONS.len()`
//! means fully migrated. Each entry runs inside its own transaction and bumps
//! the version on commit, so a crash mid-migration leaves a cleanly resumable
//! database. Never edit or reorder shipped entries — append only.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// One SQL batch per schema version, applied in order.
pub const MIGRATIONS: &[&str] = &[
    // v1 — initial schema.
    //
    // Conventions:
    // - ids are 20-char lowercase nanoids (APFS is case-insensitive)
    // - timestamps are unix milliseconds (INTEGER)
    // - `deleted_at IS NULL` = alive; non-NULL = in trash (soft delete)
    // - `storage` reserves the phase-2 reference (non-copying) mode
    // - dedupe uses a plain index on hash, not UNIQUE: soft-deleted rows and
    //   reference-mode entries would warp UNIQUE semantics — policy lives in
    //   the import pipeline instead
    // - tags tables are created now to freeze naming; tag UI lands in phase 2
    r#"
CREATE TABLE assets (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  ext          TEXT NOT NULL DEFAULT '',
  mime         TEXT,
  size         INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  duration_ms  INTEGER,
  hash_blake3  TEXT NOT NULL,
  storage      TEXT NOT NULL DEFAULT 'managed',
  src_path     TEXT,
  rel_path     TEXT NOT NULL,
  has_thumb    INTEGER NOT NULL DEFAULT 0,
  rating       INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  note         TEXT NOT NULL DEFAULT '',
  palette      TEXT,
  imported_at  INTEGER NOT NULL,
  file_mtime   INTEGER,
  file_ctime   INTEGER,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX idx_assets_alive  ON assets (deleted_at, imported_at DESC);
CREATE INDEX idx_assets_hash   ON assets (hash_blake3);
CREATE INDEX idx_assets_name   ON assets (name COLLATE NOCASE);

CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_folders_parent ON folders (parent_id, position);

CREATE TABLE asset_folders (
  asset_id  TEXT NOT NULL REFERENCES assets(id)  ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (asset_id, folder_id)
) WITHOUT ROWID;
CREATE INDEX idx_asset_folders_folder ON asset_folders (folder_id);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color      TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (asset_id, tag_id)
) WITHOUT ROWID;
"#,
    // v2 — color filtering. `hue` is the dominant-color bucket (0-11 =
    // 30°-wide hue slices, 12 = neutral/greyscale, NULL = not analyzed yet).
    // `palette` already exists (v1, reserved) and now holds the JSON swatch
    // list. The partial index keeps color-scope queries index-backed.
    r#"
ALTER TABLE assets ADD COLUMN hue INTEGER;
CREATE INDEX idx_assets_hue ON assets (hue) WHERE deleted_at IS NULL;
"#,
    // v3 — perceptual duplicate detection. 64-bit dHash of the thumbnail
    // pixels, bit-cast to INTEGER (i64); NULL = not analyzed yet (backfilled
    // on library open). Similarity scans are full popcount sweeps — no index.
    r#"
ALTER TABLE assets ADD COLUMN dhash INTEGER;
"#,
    // v4 — smart folders: saved rule sets (JSON, see commands::smart_folders)
    // that materialize as live queries at list time. No membership rows.
    r#"
CREATE TABLE smart_folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  rules      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
"#,
    // v5 — source URL (Eagle-style provenance link, editable in the
    // inspector). NULL/empty = none.
    r#"
ALTER TABLE assets ADD COLUMN url TEXT;
"#,
    // v6 — folder description (Eagle-style notes shown in the folder info
    // panel). NULL/empty = none.
    r#"
ALTER TABLE folders ADD COLUMN description TEXT;
"#,
    // v7 — full-text search over name + note. External-content FTS5 keyed on
    // the assets rowid (the TEXT id can't be an FTS rowid). Triggers keep it in
    // sync — UPDATE only fires when name/note change (rating/folder edits don't
    // touch it). Backfill existing rows. Soft-deleted rows stay indexed but are
    // excluded by the caller's `deleted_at IS NULL` predicate.
    r#"
CREATE VIRTUAL TABLE assets_fts USING fts5(
  name, note, content='assets', content_rowid='rowid'
);
INSERT INTO assets_fts (rowid, name, note)
  SELECT rowid, name, COALESCE(note, '') FROM assets;
CREATE TRIGGER assets_fts_ai AFTER INSERT ON assets BEGIN
  INSERT INTO assets_fts (rowid, name, note)
    VALUES (new.rowid, new.name, COALESCE(new.note, ''));
END;
CREATE TRIGGER assets_fts_ad AFTER DELETE ON assets BEGIN
  INSERT INTO assets_fts (assets_fts, rowid, name, note)
    VALUES ('delete', old.rowid, old.name, COALESCE(old.note, ''));
END;
CREATE TRIGGER assets_fts_au AFTER UPDATE OF name, note ON assets BEGIN
  INSERT INTO assets_fts (assets_fts, rowid, name, note)
    VALUES ('delete', old.rowid, old.name, COALESCE(old.note, ''));
  INSERT INTO assets_fts (rowid, name, note)
    VALUES (new.rowid, new.name, COALESCE(new.note, ''));
END;
"#,
    // v8 — watched folders (auto-import). Each row is an external directory the
    // app watches; new files there import into `folder_id` (NULL = library root)
    // when `auto_import` is on. `path` is unique so the same dir isn't watched
    // twice; `last_scanned_at` records the last reconciliation pass.
    r#"
CREATE TABLE watched_folders (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  auto_import INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER,
  created_at INTEGER NOT NULL
);
"#,
    // v9 — asset kind. `'file'` (default) is a normal managed file; `'link'` is
    // an Eagle-style bookmark whose managed file is the page's Open Graph cover
    // image, with the page recorded in `url`. Opening a link asset opens `url`
    // in the browser instead of the internal viewer.
    r#"
ALTER TABLE assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';
"#,
    // v10 — folder appearance (Eagle-style): `color` tints the folder glyph
    // (hex like `#3b82f6`; NULL = default neutral) and `icon` is a key into the
    // frontend's curated Solar-icon catalog (NULL = default folder glyph).
    r#"
ALTER TABLE folders ADD COLUMN color TEXT;
ALTER TABLE folders ADD COLUMN icon TEXT;
"#,
];

/// Current schema version an up-to-date library sits at.
pub fn latest_version() -> u32 {
    MIGRATIONS.len() as u32
}

/// Bring `conn` up to the latest schema version. Idempotent; rejects
/// databases written by a newer app build.
pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    let current: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current as usize > MIGRATIONS.len() {
        return Err(AppError::LibraryIncompatible(format!(
            "library schema v{current} is newer than this app supports (v{})",
            MIGRATIONS.len()
        )));
    }

    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let version = (index + 1) as u32;
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
        log::info!("migrated library schema to v{version}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        // `foreign_keys` is per-connection — without it the CASCADE test
        // below would silently pass through a broken schema.
        crate::db::apply_pragmas(&conn).expect("apply pragmas");
        conn
    }

    #[test]
    fn migrate_fresh_db_reaches_latest() {
        let mut conn = mem_conn();
        migrate(&mut conn).expect("migrate");
        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read user_version");
        assert_eq!(version, latest_version());
    }

    #[test]
    fn migrate_is_idempotent() {
        let mut conn = mem_conn();
        migrate(&mut conn).expect("first run");
        migrate(&mut conn).expect("second run");
        // Schema objects exist and are usable after repeated runs.
        conn.execute_batch("SELECT id FROM assets LIMIT 0; SELECT id FROM folders LIMIT 0;")
            .expect("tables exist");
    }

    #[test]
    fn migrate_rejects_newer_schema() {
        let mut conn = mem_conn();
        conn.pragma_update(None, "user_version", 999u32)
            .expect("set future version");
        let err = migrate(&mut conn).expect_err("must reject");
        assert!(matches!(err, AppError::LibraryIncompatible(_)));
    }

    #[test]
    fn schema_enforces_rating_range_and_cascade() {
        let mut conn = mem_conn();
        migrate(&mut conn).expect("migrate");

        conn.execute_batch(
            "INSERT INTO assets (id, name, size, hash_blake3, rel_path, imported_at, updated_at)
             VALUES ('a1b2c3d4e5f6g7h8i9j0', 'x', 1, 'h', 'assets/a1/x.png', 0, 0);
             INSERT INTO folders (id, name, created_at, updated_at)
             VALUES ('f1b2c3d4e5f6g7h8i9j0', 'F', 0, 0);
             INSERT INTO asset_folders (asset_id, folder_id, added_at)
             VALUES ('a1b2c3d4e5f6g7h8i9j0', 'f1b2c3d4e5f6g7h8i9j0', 0);",
        )
        .expect("seed");

        // rating CHECK
        let bad_rating = conn.execute(
            "UPDATE assets SET rating = 9 WHERE id = 'a1b2c3d4e5f6g7h8i9j0'",
            [],
        );
        assert!(bad_rating.is_err(), "rating > 5 must be rejected");

        // FK cascade: deleting the folder clears membership but not the asset.
        conn.execute("DELETE FROM folders WHERE id = 'f1b2c3d4e5f6g7h8i9j0'", [])
            .expect("delete folder");
        let memberships: i64 = conn
            .query_row("SELECT COUNT(*) FROM asset_folders", [], |row| row.get(0))
            .expect("count");
        assert_eq!(memberships, 0);
        let assets: i64 = conn
            .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
            .expect("count");
        assert_eq!(assets, 1);
    }
}
