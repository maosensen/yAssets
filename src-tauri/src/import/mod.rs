//! The import pipeline: paths in, catalogued assets out.
//!
//! ```text
//! import_paths (command, returns job_id immediately)
//!  └─ spawn(coordinator, blocking thread)
//!      ├─ Phase A  discover: walk dirs (no symlinks, skip hidden/Thumbs.db,
//!      │           skip anything inside the library itself)
//!      └─ Phase B  rayon pool (≤ min(cores, 8)) per file:
//!          hash (blake3, streaming) → dedupe (batch set + DB by hash)
//!          → copy into assets/<shard>/ → thumbnail (bitmap formats)
//!          → one micro-transaction INSERT → progress event (throttled)
//! ```
//!
//! Failure isolation: each file is its own transaction; a bad file records an
//! `ImportFailure` and never poisons the batch. A crash/cancel can only leave
//! id-named orphan files with no DB row — invisible and harmless (a log-only
//! sweep lands in M6). The pipeline holds its own `Arc<Library>`, so a library
//! switch mid-import stays correct: remaining commits land in the *old*
//! database until the cancel flag is observed.

pub mod color;
pub mod dhash;
pub mod thumbs;

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::Manager;
use tauri_specta::Event;
use walkdir::WalkDir;

use crate::events::{DuplicateItem, ImportFailure, ImportFinished, ImportPhase, ImportProgress};
use crate::library::{asset_rel_path, new_id, now_ms, Library};
use crate::state::AppState;

/// Progress events are throttled to at most one per this interval.
const EMIT_INTERVAL_MS: u128 = 80;
/// Parallelism cap — decode memory peak ≈ workers × largest decoded image.
const MAX_WORKERS: usize = 8;

/// Launch the coordinator for one import job. Returns immediately; progress
/// flows through `ImportProgress`/`ImportFinished` events.
pub fn spawn(
    app: tauri::AppHandle,
    library: Arc<Library>,
    cancel: Arc<AtomicBool>,
    job_id: String,
    paths: Vec<String>,
    folder_id: Option<String>,
    keep_duplicates: bool,
) {
    tauri::async_runtime::spawn(async move {
        let ctx = Arc::new(JobCtx {
            app,
            library,
            job_id,
            cancel,
            folder_id,
            keep_duplicates,
            total: AtomicU32::new(0),
            done: AtomicU32::new(0),
            imported: AtomicU32::new(0),
            skipped: AtomicU32::new(0),
            failures: Mutex::new(Vec::new()),
            duplicates: Mutex::new(Vec::new()),
            seen_hashes: Mutex::new(HashSet::new()),
            last_emit: Mutex::new(Instant::now()),
        });
        let job = Arc::clone(&ctx);
        let joined = tauri::async_runtime::spawn_blocking(move || run_job(&job, paths)).await;
        if let Err(err) = joined {
            log::error!("import job panicked/failed to join: {err}");
            ctx.finish();
        }
    });
}

struct JobCtx {
    app: tauri::AppHandle,
    library: Arc<Library>,
    job_id: String,
    cancel: Arc<AtomicBool>,
    folder_id: Option<String>,
    /// "Keep both" mode: skip library-wide dedupe (batch-local still applies).
    keep_duplicates: bool,
    total: AtomicU32,
    done: AtomicU32,
    imported: AtomicU32,
    skipped: AtomicU32,
    failures: Mutex<Vec<ImportFailure>>,
    /// Library-wide exact duplicates found this run (drives the alert dialog).
    duplicates: Mutex<Vec<DuplicateItem>>,
    seen_hashes: Mutex<HashSet<String>>,
    last_emit: Mutex<Instant>,
}

impl JobCtx {
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn record_failure(&self, path: &Path, reason: String) {
        log::warn!("import failed for {}: {reason}", path.display());
        if let Ok(mut failures) = self.failures.lock() {
            failures.push(ImportFailure {
                path: path.to_string_lossy().into_owned(),
                reason,
            });
        }
    }

    fn failed_count(&self) -> u32 {
        self.failures.lock().map(|f| f.len() as u32).unwrap_or(0)
    }

    /// Emit a progress event, rate-limited unless `force`.
    fn emit_progress(&self, phase: ImportPhase, current: Option<String>, force: bool) {
        {
            let Ok(mut last) = self.last_emit.lock() else {
                return;
            };
            if !force && last.elapsed().as_millis() < EMIT_INTERVAL_MS {
                return;
            }
            *last = Instant::now();
        }
        let event = ImportProgress {
            job_id: self.job_id.clone(),
            phase,
            done: self.done.load(Ordering::Relaxed),
            total: self.total.load(Ordering::Relaxed),
            current,
            failed: self.failed_count(),
        };
        if let Err(err) = event.emit(&self.app) {
            log::warn!("failed to emit ImportProgress: {err}");
        }
    }

    /// Terminal event + registry cleanup. Exactly once per job.
    fn finish(&self) {
        let failures = self
            .failures
            .lock()
            .map(|mut f| std::mem::take(&mut *f))
            .unwrap_or_default();
        let duplicates = self
            .duplicates
            .lock()
            .map(|mut d| std::mem::take(&mut *d))
            .unwrap_or_default();
        let event = ImportFinished {
            job_id: self.job_id.clone(),
            imported: self.imported.load(Ordering::Relaxed),
            skipped: self.skipped.load(Ordering::Relaxed),
            failed: failures,
            duplicates,
            cancelled: self.cancelled(),
        };
        log::info!(
            "import {} finished: imported={} skipped={} duplicates={} failed={} cancelled={}",
            self.job_id,
            event.imported,
            event.skipped,
            event.duplicates.len(),
            event.failed.len(),
            event.cancelled
        );
        if let Err(err) = event.emit(&self.app) {
            log::warn!("failed to emit ImportFinished: {err}");
        }
        self.app.state::<AppState>().finish_import(&self.job_id);
    }
}

fn run_job(ctx: &Arc<JobCtx>, paths: Vec<String>) {
    // Phase A — discovery.
    let files = discover(
        paths.iter().map(PathBuf::from),
        ctx.library.root(),
        |found| {
            ctx.total.store(found, Ordering::Relaxed);
            ctx.emit_progress(ImportPhase::Discovering, None, false);
        },
        || ctx.cancelled(),
    );
    ctx.total.store(files.len() as u32, Ordering::Relaxed);
    ctx.emit_progress(ImportPhase::Processing, None, true);

    // Mirror the dropped directory structure as library folders — one writer
    // transaction before the parallel phase (folder counts are tiny). On
    // failure we degrade gracefully: files land in the drop target instead.
    let folder_map = build_folder_map(&ctx.library, ctx.folder_id.as_deref(), &files)
        .unwrap_or_else(|err| {
            log::error!("failed to prepare import folders: {err}");
            std::collections::HashMap::new()
        });

    // Phase B — parallel processing.
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(MAX_WORKERS);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(workers).build();
    match pool {
        Ok(pool) => pool.install(|| {
            use rayon::prelude::*;
            files.par_iter().for_each(|file| {
                if ctx.cancelled() {
                    return;
                }
                let path = &file.path;
                // Nested files attach to their mirrored folder; loose files
                // (and map misses) keep the drop target.
                let target_folder = if file.folder_components.is_empty() {
                    ctx.folder_id.as_deref()
                } else {
                    folder_map
                        .get(&file.folder_components.join("/"))
                        .map(String::as_str)
                        .or(ctx.folder_id.as_deref())
                };
                match process_file(
                    &ctx.library,
                    path,
                    target_folder,
                    &ctx.seen_hashes,
                    ctx.keep_duplicates,
                ) {
                    Ok(FileOutcome::Imported) => {
                        ctx.imported.fetch_add(1, Ordering::Relaxed);
                    }
                    Ok(FileOutcome::Skipped) => {
                        ctx.skipped.fetch_add(1, Ordering::Relaxed);
                    }
                    Ok(FileOutcome::Duplicate { existing_id }) => {
                        ctx.skipped.fetch_add(1, Ordering::Relaxed);
                        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                        if let Ok(mut duplicates) = ctx.duplicates.lock() {
                            duplicates.push(DuplicateItem {
                                src_path: path.to_string_lossy().into_owned(),
                                name: display_name(path),
                                size: size as f64,
                                existing_id,
                            });
                        }
                    }
                    Err(reason) => ctx.record_failure(path, reason),
                }
                ctx.done.fetch_add(1, Ordering::Relaxed);
                ctx.emit_progress(
                    ImportPhase::Processing,
                    path.file_name().map(|n| n.to_string_lossy().into_owned()),
                    false,
                );
            });
        }),
        Err(err) => {
            log::error!("failed to build import thread pool: {err}");
        }
    }

    ctx.emit_progress(ImportPhase::Processing, None, true);
    ctx.finish();
}

/// One discovered file plus the directory chain to recreate in the library.
#[derive(Debug)]
pub(crate) struct DiscoveredFile {
    pub path: PathBuf,
    /// Folder chain relative to the drop — leads with the dropped directory's
    /// own name (`X/sub/a.png` → `["X", "sub"]`); empty for loose files.
    pub folder_components: Vec<String>,
}

/// Expand user-dropped paths into a file list, remembering each file's
/// directory chain so imports can mirror nested folder structures.
///
/// Rules: explicitly listed files are always included (user intent); directory
/// walks skip hidden entries and `Thumbs.db`, never follow symlinks, and
/// anything inside the library folder itself is excluded (dropping the
/// library into the library must not recurse).
pub(crate) fn discover(
    inputs: impl Iterator<Item = PathBuf>,
    library_root: &Path,
    mut on_progress: impl FnMut(u32),
    cancelled: impl Fn() -> bool,
) -> Vec<DiscoveredFile> {
    let mut files = Vec::new();
    for input in inputs {
        if cancelled() {
            break;
        }
        if input.starts_with(library_root) {
            log::warn!(
                "skipping import from inside the library: {}",
                input.display()
            );
            continue;
        }
        if input.is_file() {
            files.push(DiscoveredFile {
                path: input,
                folder_components: Vec::new(),
            });
        } else if input.is_dir() {
            // Chains are measured from the drop's PARENT, so the dropped
            // directory itself becomes the top of the recreated tree.
            let base = input
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| input.clone());
            let walker = WalkDir::new(&input)
                .follow_links(false)
                .into_iter()
                .filter_entry(|entry| {
                    // Applies to *children* of the dropped dir; the dropped
                    // dir itself passes even when hidden (explicit intent).
                    entry.depth() == 0 || !is_junk(entry.file_name())
                });
            for entry in walker.filter_map(Result::ok) {
                if cancelled() {
                    break;
                }
                if entry.file_type().is_file() {
                    if entry.path().starts_with(library_root) {
                        continue;
                    }
                    let folder_components = entry
                        .path()
                        .parent()
                        .and_then(|dir| dir.strip_prefix(&base).ok())
                        .map(|rel| {
                            rel.components()
                                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                                .collect()
                        })
                        .unwrap_or_default();
                    files.push(DiscoveredFile {
                        path: entry.into_path(),
                        folder_components,
                    });
                    if files.len() % 100 == 0 {
                        on_progress(files.len() as u32);
                    }
                }
            }
        }
        // Nonexistent paths fall through silently — the OS gave them to us
        // moments ago; racing deletions just shrink the batch.
    }
    on_progress(files.len() as u32);
    files
}

/// Create (or reuse) every folder chain the discovery produced, rooted under
/// `root_folder`. Same-named siblings merge case-insensitively, so importing
/// the same tree twice converges instead of duplicating folders. Returns
/// joined-chain ("a/b") → folder id.
fn build_folder_map(
    library: &Library,
    root_folder: Option<&str>,
    files: &[DiscoveredFile],
) -> crate::error::AppResult<std::collections::HashMap<String, String>> {
    use std::collections::{BTreeSet, HashMap};

    // Every prefix of every chain; BTreeSet orders parents before children.
    let mut chains: BTreeSet<Vec<String>> = BTreeSet::new();
    for file in files {
        for depth in 1..=file.folder_components.len() {
            chains.insert(file.folder_components[..depth].to_vec());
        }
    }
    if chains.is_empty() {
        return Ok(HashMap::new());
    }

    let root = root_folder.map(str::to_owned);
    library.with_writer(move |conn| {
        let tx = conn.transaction()?;
        let mut map: HashMap<String, String> = HashMap::new();
        for chain in &chains {
            let parent = if chain.len() == 1 {
                root.clone()
            } else {
                map.get(&chain[..chain.len() - 1].join("/")).cloned()
            };
            let name = chain.last().expect("chains are non-empty");
            let id = ensure_folder(&tx, parent.as_deref(), name)?;
            map.insert(chain.join("/"), id);
        }
        tx.commit()?;
        Ok(map)
    })
}

/// Find a same-named child folder (case-insensitive) or create it.
fn ensure_folder(
    conn: &rusqlite::Connection,
    parent: Option<&str>,
    name: &str,
) -> rusqlite::Result<String> {
    // `IS` (not `=`) so a NULL parent compares as root-level.
    if let Ok(existing) = conn.query_row(
        "SELECT id FROM folders WHERE name = ?1 COLLATE NOCASE AND parent_id IS ?2",
        rusqlite::params![name, parent],
        |row| row.get::<_, String>(0),
    ) {
        return Ok(existing);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO folders (id, parent_id, name, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        rusqlite::params![id, parent, name, now_ms()],
    )?;
    Ok(id)
}

/// Hidden files and OS litter — skipped by import discovery and by the
/// orphan sweep (macOS drops `.DS_Store` inside `assets/` shards).
pub(crate) fn is_junk(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    name.starts_with('.') || name.eq_ignore_ascii_case("thumbs.db")
}

#[derive(Debug)]
pub(crate) enum FileOutcome {
    Imported,
    /// Batch-internal repeat (same file twice in one drop) — silent.
    Skipped,
    /// Exact content (blake3) already cataloged — surfaces in the alert.
    Duplicate {
        existing_id: String,
    },
}

/// Hash → dedupe → copy → thumbnail → single-transaction insert.
/// Errors are per-file (returned as a displayable reason string).
pub(crate) fn process_file(
    library: &Library,
    path: &Path,
    folder_id: Option<&str>,
    seen_hashes: &Mutex<HashSet<String>>,
    keep_duplicates: bool,
) -> Result<FileOutcome, String> {
    process_file_with_source(
        library,
        path,
        folder_id,
        seen_hashes,
        keep_duplicates,
        None,
        None,
    )
}

/// Like `process_file`, but records `source` (a provenance URL) and an optional
/// `note` (an attribution line) on the asset. The Discover feature imports
/// downloaded third-party images this way, crediting CC/Pexels sources.
pub(crate) fn process_file_with_source(
    library: &Library,
    path: &Path,
    folder_id: Option<&str>,
    seen_hashes: &Mutex<HashSet<String>>,
    keep_duplicates: bool,
    source: Option<&str>,
    note: Option<&str>,
) -> Result<FileOutcome, String> {
    process_file_with_meta(
        library,
        path,
        folder_id,
        seen_hashes,
        keep_duplicates,
        source,
        note,
        "file",
        None,
    )
}

/// The full import entry point. Beyond `source`/`note`, it records the asset
/// `kind` (`"file"` | `"link"`) and an optional `name_override` (used by the
/// paste-a-URL link importer, whose display name is the page title, not the
/// downloaded cover's filename).
#[allow(clippy::too_many_arguments)]
pub(crate) fn process_file_with_meta(
    library: &Library,
    path: &Path,
    folder_id: Option<&str>,
    seen_hashes: &Mutex<HashSet<String>>,
    keep_duplicates: bool,
    source: Option<&str>,
    note: Option<&str>,
    kind: &str,
    name_override: Option<&str>,
) -> Result<FileOutcome, String> {
    let hash = hash_file(path).map_err(|err| format!("hash failed: {err}"))?;

    // Batch-local dedupe (two copies of the same file in one drop).
    {
        let mut seen = seen_hashes.lock().map_err(|_| "internal lock error")?;
        if !seen.insert(hash.clone()) {
            return Ok(FileOutcome::Skipped);
        }
    }

    // Library-wide dedupe (L1 exact, blake3): an alive asset with the same
    // content wins; a targeted folder still gains membership of the existing
    // asset. "Keep both" jobs skip this check entirely. Only files dedupe
    // against files: a link asset's stored cover image must never swallow a
    // real file import (nor vice versa — link imports pass keep_duplicates).
    if !keep_duplicates {
        let existing: Option<String> = library
            .with_reader(|conn| {
                Ok(conn
                    .query_row(
                        "SELECT id FROM assets
                           WHERE hash_blake3 = ?1 AND deleted_at IS NULL AND kind = 'file'
                           LIMIT 1",
                        [&hash],
                        |row| row.get(0),
                    )
                    .ok())
            })
            .map_err(|err| err.to_string())?;
        if let Some(existing_id) = existing {
            if let Some(folder) = folder_id {
                library
                    .with_writer(|conn| {
                        conn.execute(
                            "INSERT OR IGNORE INTO asset_folders (asset_id, folder_id, added_at)
                             VALUES (?1, ?2, ?3)",
                            rusqlite::params![existing_id, folder, now_ms()],
                        )?;
                        Ok(())
                    })
                    .map_err(|err| err.to_string())?;
            }
            return Ok(FileOutcome::Duplicate { existing_id });
        }
    }

    let metadata = std::fs::metadata(path).map_err(|err| format!("stat failed: {err}"))?;
    let name = name_override
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| display_name(path));
    let ext_display = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    // The on-disk extension is sanitized (path-safe); the DB keeps the real one.
    let ext_file: String = ext_display
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(16)
        .collect();

    let id = new_id();
    let rel_path = asset_rel_path(&id, &ext_file);
    let dest = library.resolve_rel(&rel_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("mkdir failed: {err}"))?;
    }
    std::fs::copy(path, &dest).map_err(|err| format!("copy failed: {err}"))?;

    // Thumbnail: best effort — a corrupt bitmap still imports, just thumbless.
    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;
    let mut has_thumb = false;
    let mut hue: Option<u8> = None;
    let mut palette: Option<String> = None;
    let mut dhash: Option<i64> = None;
    if thumbs::is_thumbable_ext(&ext_display) {
        match thumbs::generate(&dest, &library.thumb_path(&id), &ext_display) {
            Ok(outcome) => {
                width = Some(outcome.width);
                height = Some(outcome.height);
                has_thumb = true;
                hue = outcome.hue;
                palette = outcome.palette;
                dhash = outcome.dhash;
            }
            Err(err) => {
                log::warn!("thumbnail failed for {}: {err}", path.display());
            }
        }
    }

    let mime = mime_guess::from_path(path).first().map(|m| m.to_string());
    let now = now_ms();
    let inserted = library.with_writer(|conn| {
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO assets (
               id, name, ext, mime, size, width, height, hash_blake3,
               storage, src_path, rel_path, has_thumb, hue, palette, dhash,
               imported_at, file_mtime, file_ctime, updated_at, url, note, kind
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                       'managed', ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?15, ?18, ?19, ?20)",
            rusqlite::params![
                id,
                name,
                ext_display,
                mime,
                metadata.len() as i64,
                width,
                height,
                hash,
                path.to_string_lossy(),
                rel_path,
                has_thumb,
                hue,
                palette,
                dhash,
                now,
                system_time_ms(metadata.modified().ok()),
                system_time_ms(metadata.created().ok()),
                source,
                note.unwrap_or(""),
                kind,
            ],
        )?;
        if let Some(folder) = folder_id {
            tx.execute(
                "INSERT OR IGNORE INTO asset_folders (asset_id, folder_id, added_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![id, folder, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    });

    if let Err(err) = inserted {
        // Roll the filesystem back so no orphan outlives a failed insert.
        let _ = std::fs::remove_file(&dest);
        let _ = std::fs::remove_file(library.thumb_path(&id));
        return Err(format!("db insert failed: {err}"));
    }

    Ok(FileOutcome::Imported)
}

fn display_name(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".to_string())
}

fn system_time_ms(time: Option<std::time::SystemTime>) -> Option<i64> {
    time.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut hasher = blake3::Hasher::new();
    let mut file = std::fs::File::open(path)?;
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

/// Convenience for commands: allocate a job id.
pub fn new_job_id() -> String {
    new_id()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_library() -> (tempfile::TempDir, Library) {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let root = tmp.path().join("Lib");
        let lib = Library::create(&root).expect("create library");
        (tmp, lib)
    }

    fn write_png(path: &Path, w: u32, h: u32, seed: u8) {
        let img = image::RgbaImage::from_fn(w, h, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, seed, 255])
        });
        img.save(path).expect("write png fixture");
    }

    fn count_assets(lib: &Library) -> i64 {
        lib.with_reader(|conn| {
            Ok(conn
                .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
                .expect("count"))
        })
        .expect("reader")
    }

    #[test]
    fn discover_skips_hidden_junk_and_library_itself() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let drop_dir = tmp.path().join("drop");
        std::fs::create_dir_all(drop_dir.join("sub")).expect("mkdir");
        std::fs::write(drop_dir.join("a.png"), b"a").expect("w");
        std::fs::write(drop_dir.join("sub/b.jpg"), b"b").expect("w");
        std::fs::write(drop_dir.join(".hidden.png"), b"h").expect("w");
        std::fs::write(drop_dir.join("Thumbs.db"), b"t").expect("w");
        std::fs::create_dir_all(drop_dir.join(".git")).expect("mkdir");
        std::fs::write(drop_dir.join(".git/blob"), b"g").expect("w");

        let lib_root = tmp.path().join("Lib");
        std::fs::create_dir_all(&lib_root).expect("mkdir");

        let explicit_hidden = tmp.path().join(".explicit.png");
        std::fs::write(&explicit_hidden, b"e").expect("w");

        let inside_lib = lib_root.join("inside.png");
        std::fs::write(&inside_lib, b"i").expect("w");

        let files = discover(
            vec![drop_dir.clone(), explicit_hidden.clone(), inside_lib].into_iter(),
            &lib_root,
            |_| {},
            || false,
        );

        let names: Vec<String> = files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"a.png".to_string()));
        assert!(names.contains(&"b.jpg".to_string()));
        // Explicitly dropped hidden file is honored (user intent)…
        assert!(names.contains(&".explicit.png".to_string()));
        // …but walked hidden entries, junk, and library-internal files are not.
        assert!(!names.contains(&".hidden.png".to_string()));
        assert!(!names.iter().any(|n| n.eq_ignore_ascii_case("thumbs.db")));
        assert!(!names.contains(&"blob".to_string()));
        assert!(!names.contains(&"inside.png".to_string()));

        // Folder chains lead with the dropped directory's own name.
        let chain_of = |file_name: &str| {
            files
                .iter()
                .find(|f| f.path.file_name().unwrap().to_string_lossy() == file_name)
                .map(|f| f.folder_components.clone())
                .expect("file present")
        };
        assert_eq!(chain_of("a.png"), vec!["drop".to_string()]);
        assert_eq!(
            chain_of("b.jpg"),
            vec!["drop".to_string(), "sub".to_string()]
        );
        // Loose (explicitly dropped) files carry no chain.
        assert_eq!(chain_of(".explicit.png"), Vec::<String>::new());
    }

    #[test]
    fn build_folder_map_creates_and_reuses_nested_folders() {
        let (tmp, lib) = test_library();
        let drop_dir = tmp.path().join("pack");
        std::fs::create_dir_all(drop_dir.join("icons/dark")).expect("mkdir");
        write_png(&drop_dir.join("cover.png"), 8, 8, 1);
        write_png(&drop_dir.join("icons/a.png"), 8, 8, 2);
        write_png(&drop_dir.join("icons/dark/b.png"), 8, 8, 3);

        let files = discover(vec![drop_dir].into_iter(), lib.root(), |_| {}, || false);
        let map = build_folder_map(&lib, None, &files).expect("map");
        assert_eq!(map.len(), 3); // pack, pack/icons, pack/icons/dark

        let folder_count = |lib: &Library| -> i64 {
            lib.with_reader(|conn| {
                Ok(conn
                    .query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0))
                    .expect("count"))
            })
            .expect("reader")
        };
        assert_eq!(folder_count(&lib), 3);

        // Hierarchy is wired: pack/icons/dark's parent is pack/icons.
        let dark = map.get("pack/icons/dark").expect("dark id").clone();
        let icons = map.get("pack/icons").expect("icons id").clone();
        let parent: Option<String> = lib
            .with_reader(move |conn| {
                Ok(conn
                    .query_row(
                        "SELECT parent_id FROM folders WHERE id = ?1",
                        [dark.as_str()],
                        |row| row.get(0),
                    )
                    .expect("row"))
            })
            .expect("reader");
        assert_eq!(parent.as_deref(), Some(icons.as_str()));

        // Re-importing the same tree reuses every folder (no duplicates).
        let files_again = discover(
            vec![tmp.path().join("pack")].into_iter(),
            lib.root(),
            |_| {},
            || false,
        );
        let map_again = build_folder_map(&lib, None, &files_again).expect("map again");
        assert_eq!(map_again, map);
        assert_eq!(folder_count(&lib), 3);
    }

    #[test]
    fn process_file_imports_bitmap_with_thumb_and_dims() {
        let (tmp, lib) = test_library();
        let src = tmp.path().join("photo.png");
        write_png(&src, 800, 600, 1);

        let seen = Mutex::new(HashSet::new());
        let outcome = process_file(&lib, &src, None, &seen, false).expect("import");
        assert!(matches!(outcome, FileOutcome::Imported));

        lib.with_reader(|conn| {
            let (name, ext, w, h, has_thumb, rel): (String, String, u32, u32, bool, String) = conn
                .query_row(
                    "SELECT name, ext, width, height, has_thumb, rel_path FROM assets",
                    [],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                        ))
                    },
                )
                .expect("row");
            assert_eq!(name, "photo");
            assert_eq!(ext, "png");
            assert_eq!((w, h), (800, 600));
            assert!(has_thumb);
            // Copied file and thumbnail actually exist on disk.
            assert!(lib.resolve_rel(&rel).is_file());
            Ok(())
        })
        .expect("reader");
        let thumb_count = walkdir::WalkDir::new(lib.root().join("thumbs"))
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .count();
        assert_eq!(thumb_count, 1);
    }

    #[test]
    fn process_file_with_source_records_provenance_url() {
        let (tmp, lib) = test_library();
        let src = tmp.path().join("remote.png");
        write_png(&src, 320, 200, 7);

        let seen = Mutex::new(HashSet::new());
        let outcome = process_file_with_source(
            &lib,
            &src,
            None,
            &seen,
            false,
            Some("https://wallhaven.cc/w/abc123"),
            Some("By Jane Doe · CC BY 4.0"),
        )
        .expect("import");
        assert!(matches!(outcome, FileOutcome::Imported));

        let (url, note): (Option<String>, String) = lib
            .with_reader(|conn| {
                Ok(conn
                    .query_row("SELECT url, note FROM assets", [], |row| {
                        Ok((row.get(0)?, row.get(1)?))
                    })
                    .expect("row"))
            })
            .expect("reader");
        assert_eq!(url.as_deref(), Some("https://wallhaven.cc/w/abc123"));
        assert_eq!(note, "By Jane Doe · CC BY 4.0");
    }

    #[test]
    fn process_file_with_meta_records_link_kind_and_title() {
        let (tmp, lib) = test_library();
        // The link's stored file is its (cover) image; kind + name come from the
        // page, not the file.
        let cover = tmp.path().join("cover.png");
        write_png(&cover, 1200, 630, 9);

        let seen = Mutex::new(HashSet::new());
        let outcome = process_file_with_meta(
            &lib,
            &cover,
            None,
            &seen,
            true,
            Some("https://x.com/user/status/123"),
            Some("A great thread about design."),
            "link",
            Some("AI agent workflow product design"),
        )
        .expect("import link");
        assert!(matches!(outcome, FileOutcome::Imported));

        let (name, kind, url): (String, String, Option<String>) = lib
            .with_reader(|conn| {
                Ok(conn
                    .query_row("SELECT name, kind, url FROM assets", [], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })
                    .expect("row"))
            })
            .expect("reader");
        assert_eq!(name, "AI agent workflow product design");
        assert_eq!(kind, "link");
        assert_eq!(url.as_deref(), Some("https://x.com/user/status/123"));
    }

    #[test]
    fn file_import_does_not_dedupe_onto_a_link_cover() {
        let (tmp, lib) = test_library();
        // A link's cover and a standalone file can be byte-identical.
        let cover = tmp.path().join("cover.png");
        write_png(&cover, 200, 120, 42);
        let same = tmp.path().join("same.png");
        write_png(&same, 200, 120, 42);

        // Import the page as a link (its cover is the managed file).
        let seen = Mutex::new(HashSet::new());
        process_file_with_meta(
            &lib,
            &cover,
            None,
            &seen,
            true,
            Some("https://example.com/post"),
            None,
            "link",
            Some("A Post"),
        )
        .expect("import link");

        // Importing the identical image as a normal file must NOT collapse onto
        // the bookmark — it imports as its own file asset.
        let seen2 = Mutex::new(HashSet::new());
        let outcome = process_file(&lib, &same, None, &seen2, false).expect("import file");
        assert!(
            matches!(outcome, FileOutcome::Imported),
            "file import wrongly deduped onto a link cover"
        );

        let (files, links): (i64, i64) = lib
            .with_reader(|conn| {
                Ok(conn
                    .query_row(
                        "SELECT
                           (SELECT COUNT(*) FROM assets WHERE kind = 'file'),
                           (SELECT COUNT(*) FROM assets WHERE kind = 'link')",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .expect("counts"))
            })
            .expect("reader");
        assert_eq!((files, links), (1, 1));
    }

    #[test]
    fn process_file_defaults_kind_to_file() {
        let (tmp, lib) = test_library();
        let src = tmp.path().join("plain.png");
        write_png(&src, 64, 64, 3);
        let seen = Mutex::new(HashSet::new());
        process_file(&lib, &src, None, &seen, false).expect("import");
        let kind: String = lib
            .with_reader(|conn| {
                Ok(conn
                    .query_row("SELECT kind FROM assets", [], |row| row.get(0))
                    .expect("row"))
            })
            .expect("reader");
        assert_eq!(kind, "file");
    }

    #[test]
    fn process_file_skips_duplicates_within_batch_and_db() {
        let (tmp, lib) = test_library();
        let src = tmp.path().join("dup.png");
        write_png(&src, 64, 64, 2);
        let copy = tmp.path().join("dup-copy.png");
        std::fs::copy(&src, &copy).expect("copy fixture");

        let seen = Mutex::new(HashSet::new());
        assert!(matches!(
            process_file(&lib, &src, None, &seen, false).expect("first"),
            FileOutcome::Imported
        ));
        // Same batch, identical bytes → batch-set skip.
        assert!(matches!(
            process_file(&lib, &copy, None, &seen, false).expect("second"),
            FileOutcome::Skipped
        ));
        // New batch (fresh seen set) → DB-hash hit surfaces as a Duplicate.
        let seen2 = Mutex::new(HashSet::new());
        assert!(matches!(
            process_file(&lib, &copy, None, &seen2, false).expect("third"),
            FileOutcome::Duplicate { .. }
        ));
        assert_eq!(count_assets(&lib), 1);

        // "Keep both" disables the library-wide check → a second row lands.
        let seen3 = Mutex::new(HashSet::new());
        assert!(matches!(
            process_file(&lib, &copy, None, &seen3, true).expect("keep both"),
            FileOutcome::Imported
        ));
        assert_eq!(count_assets(&lib), 2);
    }

    #[test]
    fn process_file_attaches_duplicate_to_folder() {
        let (tmp, lib) = test_library();
        let src = tmp.path().join("x.png");
        write_png(&src, 32, 32, 3);

        lib.with_writer(|conn| {
            conn.execute(
                "INSERT INTO folders (id, name, position, created_at, updated_at)
                 VALUES ('f0000000000000000001', 'F', 0, 0, 0)",
                [],
            )?;
            Ok(())
        })
        .expect("seed folder");

        let seen = Mutex::new(HashSet::new());
        process_file(&lib, &src, None, &seen, false).expect("import plain");
        // Re-import the same content targeted at a folder: skipped but attached.
        let seen2 = Mutex::new(HashSet::new());
        assert!(matches!(
            process_file(&lib, &src, Some("f0000000000000000001"), &seen2, false).expect("re"),
            FileOutcome::Duplicate { .. }
        ));
        let memberships: i64 = lib
            .with_reader(|conn| {
                Ok(conn
                    .query_row("SELECT COUNT(*) FROM asset_folders", [], |row| row.get(0))
                    .expect("count"))
            })
            .expect("reader");
        assert_eq!(memberships, 1);
        assert_eq!(count_assets(&lib), 1);
    }

    #[test]
    fn process_file_imports_non_image_without_thumb() {
        let (tmp, lib) = test_library();
        let src = tmp.path().join("notes.txt");
        std::fs::write(&src, b"hello yassets").expect("fixture");

        let seen = Mutex::new(HashSet::new());
        assert!(matches!(
            process_file(&lib, &src, None, &seen, false).expect("import"),
            FileOutcome::Imported
        ));
        lib.with_reader(|conn| {
            let (ext, has_thumb, width): (String, bool, Option<u32>) = conn
                .query_row("SELECT ext, has_thumb, width FROM assets", [], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .expect("row");
            assert_eq!(ext, "txt");
            assert!(!has_thumb);
            assert_eq!(width, None);
            Ok(())
        })
        .expect("reader");
    }

    #[test]
    fn process_file_imports_corrupt_bitmap_thumbless() {
        let (tmp, lib) = test_library();
        let src = tmp.path().join("broken.png");
        std::fs::write(&src, b"not really a png").expect("fixture");

        let seen = Mutex::new(HashSet::new());
        assert!(matches!(
            process_file(&lib, &src, None, &seen, false).expect("import"),
            FileOutcome::Imported
        ));
        lib.with_reader(|conn| {
            let has_thumb: bool = conn
                .query_row("SELECT has_thumb FROM assets", [], |row| row.get(0))
                .expect("row");
            assert!(!has_thumb);
            Ok(())
        })
        .expect("reader");
    }

    #[test]
    fn process_file_errors_on_missing_source() {
        let (tmp, lib) = test_library();
        let seen = Mutex::new(HashSet::new());
        let err = process_file(&lib, &tmp.path().join("ghost.png"), None, &seen, false)
            .expect_err("must fail");
        assert!(err.contains("hash failed"));
        assert_eq!(count_assets(&lib), 0);
    }
}
