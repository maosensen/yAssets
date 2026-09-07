//! Library-wide duplicate scan — the reporting side of the layered
//! duplicate strategy (import-time blocking lives in the import pipeline).
//!
//! - **Exact groups**: alive assets sharing a blake3 hash (byte-identical).
//!   Safe to clean mechanically — the UI keeps the earliest import and
//!   trashes the rest (soft delete, recoverable).
//! - **Visual clusters**: dHash union-find over one representative per hash
//!   (so exact groups never re-appear here), edges at Hamming distance ≤
//!   [`crate::import::dhash::SIMILAR_MAX_DISTANCE`]. Presented for review,
//!   not mechanical deletion — "similar" is a judgement call.
//!
//! The two differ on `kind` by choice: exact groups are files only, clusters
//! are not. Only exact groups drive a destructive button, so only they need to
//! match the import pipeline's file-vs-file dedupe; a cluster's one action is
//! "Compare", and a link cover that looks like a catalogued image is worth
//! putting in front of the user rather than hiding.

use serde::Serialize;

use crate::commands::assets::{summary_from_row, AssetSummary, SUMMARY_COLS};
use crate::error::AppResult;
use crate::import::dhash;
use crate::state::AppState;

#[derive(Debug, Serialize, specta::Type)]
pub struct DuplicateScan {
    /// Groups of byte-identical assets (each group ≥ 2, ordered oldest-first).
    pub exact: Vec<Vec<AssetSummary>>,
    /// Clusters of visually-similar assets (across different hashes).
    pub visual: Vec<Vec<AssetSummary>>,
}

/// Exact-duplicate groups: alive **file** assets sharing a blake3 hash, each
/// group ordered oldest-first. Reads the hash by column NAME (not index) so a
/// change to `SUMMARY_COLS`'s width can't silently shift the read.
///
/// `kind = 'file'` mirrors the import pipeline's dedupe, and this is the query
/// that has to: its groups drive a mechanical trash-all. A link bookmark is
/// identified by its URL, not by the bytes of the cover image fetched for it —
/// so two pages sharing a stock og-image are not duplicates, and a link whose
/// cover matches a real file is not one either. The import side lets both
/// coexist on purpose; offering to delete one here would undo that. Filtering
/// both the outer query and the `HAVING` subquery matters: filtering only the
/// outer one would let a file+link pair satisfy `COUNT(*) > 1` and then render
/// as a bogus single-member group.
fn exact_duplicate_groups(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<Vec<AssetSummary>>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUMMARY_COLS}, hash_blake3 FROM assets
         WHERE deleted_at IS NULL AND kind = 'file' AND hash_blake3 IN (
           SELECT hash_blake3 FROM assets
           WHERE deleted_at IS NULL AND kind = 'file'
           GROUP BY hash_blake3 HAVING COUNT(*) > 1
         )
         ORDER BY hash_blake3, imported_at"
    ))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((summary_from_row(row)?, row.get::<_, String>("hash_blake3")?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut exact: Vec<Vec<AssetSummary>> = Vec::new();
    let mut last_hash: Option<String> = None;
    for (summary, hash) in rows {
        if last_hash.as_deref() != Some(hash.as_str()) {
            exact.push(Vec::new());
            last_hash = Some(hash);
        }
        if let Some(group) = exact.last_mut() {
            group.push(summary);
        }
    }
    Ok(exact)
}

/// Scan the whole library for exact and visual duplicates. Shared by the command
/// and the agent API.
pub(crate) fn scan_duplicates_in(conn: &rusqlite::Connection) -> AppResult<DuplicateScan> {
    let exact = exact_duplicate_groups(conn)?;

    // --- Visual: union-find over per-hash representatives. --------
    let mut stmt = conn.prepare(
        "SELECT id, dhash, hash_blake3 FROM assets
         WHERE deleted_at IS NULL AND dhash IS NOT NULL
         ORDER BY imported_at",
    )?;
    let fingerprints = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    // One representative per content hash (earliest import wins).
    let mut seen_hashes = std::collections::HashSet::new();
    let reps: Vec<(String, u64)> = fingerprints
        .into_iter()
        .filter(|(_, _, hash)| seen_hashes.insert(hash.clone()))
        .map(|(id, dhash, _)| (id, dhash as u64))
        .collect();

    let clusters = cluster_by_distance(&reps, dhash::SIMILAR_MAX_DISTANCE);

    // Resolve summaries for every clustered id in chunked IN()s.
    let all_ids: Vec<&String> = clusters.iter().flatten().collect();
    let mut by_id = std::collections::HashMap::new();
    for chunk in all_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("SELECT {SUMMARY_COLS} FROM assets WHERE id IN ({placeholders})");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(chunk.iter()), summary_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for summary in rows {
            by_id.insert(summary.id.clone(), summary);
        }
    }
    let visual = clusters
        .into_iter()
        .map(|ids| {
            ids.iter()
                .filter_map(|id| by_id.remove(id))
                .collect::<Vec<_>>()
        })
        .filter(|group| group.len() > 1)
        .collect();

    Ok(DuplicateScan { exact, visual })
}

#[tauri::command]
#[specta::specta]
pub async fn scan_duplicates(state: tauri::State<'_, AppState>) -> AppResult<DuplicateScan> {
    let library = state.current_library()?;
    library.read(scan_duplicates_in).await
}

/// Union-find clustering of (id, dhash) pairs by Hamming distance. O(n²)
/// popcount over per-hash representatives — a few thousand reps is
/// milliseconds; revisit with a BK-tree if libraries reach 100k+.
fn cluster_by_distance(reps: &[(String, u64)], max_distance: u32) -> Vec<Vec<String>> {
    let n = reps.len();
    let mut parent: Vec<usize> = (0..n).collect();

    fn find(parent: &mut [usize], i: usize) -> usize {
        let mut root = i;
        while parent[root] != root {
            root = parent[root];
        }
        // Path compression.
        let mut cursor = i;
        while parent[cursor] != root {
            let next = parent[cursor];
            parent[cursor] = root;
            cursor = next;
        }
        root
    }

    for i in 0..n {
        for j in (i + 1)..n {
            if dhash::distance(reps[i].1, reps[j].1) <= max_distance {
                let (a, b) = (find(&mut parent, i), find(&mut parent, j));
                if a != b {
                    parent[a] = b;
                }
            }
        }
    }

    let mut groups: std::collections::HashMap<usize, Vec<String>> =
        std::collections::HashMap::new();
    for (i, rep) in reps.iter().enumerate() {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(rep.0.clone());
    }
    let mut clusters: Vec<Vec<String>> = groups
        .into_values()
        .filter(|members| members.len() > 1)
        .collect();
    // Stable output order: biggest clusters first, then by first member id.
    clusters.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a[0].cmp(&b[0])));
    clusters
}

#[cfg(test)]
mod tests {
    use super::{cluster_by_distance, exact_duplicate_groups};
    use crate::library::Library;

    fn ids(cluster: &[String]) -> Vec<&str> {
        cluster.iter().map(String::as_str).collect()
    }

    /// A link's cover bytes must not group with a real file's. The import
    /// pipeline deliberately lets them coexist, and this group feeds a
    /// mechanical trash-all — grouping them would offer to delete a bookmark
    /// because a stock og-image matched an image already in the library.
    #[test]
    fn a_link_cover_never_groups_with_a_file_of_the_same_bytes() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let lib = Library::create(&tmp.path().join("Lib")).expect("create");
        lib.with_writer(|conn| {
            conn.execute_batch(
                "INSERT INTO assets (id, name, ext, size, hash_blake3, rel_path, imported_at, updated_at, kind)
                 VALUES ('bb000000000000000001','file','png',10,'shared','assets/bb/a.png',1,0,'file'),
                        ('bb000000000000000002','link','png',10,'shared','assets/bb/b.png',2,0,'link'),
                        ('bb000000000000000003','l2','png',10,'twolinks','assets/bb/c.png',3,0,'link'),
                        ('bb000000000000000004','l3','png',10,'twolinks','assets/bb/d.png',4,0,'link');",
            )?;
            Ok(())
        })
        .expect("seed");

        lib.with_reader(|conn| {
            // One file + one link sharing bytes: no group, and specifically not
            // a one-member group (which the subquery would emit if only the
            // outer query were filtered).
            // Two links sharing bytes: also no group — a bookmark's identity is
            // its URL, not its cover.
            assert!(exact_duplicate_groups(conn)?.is_empty());
            Ok(())
        })
        .expect("reader");
    }

    /// Guards the `SELECT {SUMMARY_COLS}, hash_blake3` column read against
    /// SUMMARY_COLS width drift (a duration_ms addition once shifted the hash).
    #[test]
    fn exact_groups_read_hash_after_summary_cols() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let lib = Library::create(&tmp.path().join("Lib")).expect("create");
        lib.with_writer(|conn| {
            // Two byte-identical assets (shared hash 'dup') + one unique.
            conn.execute_batch(
                "INSERT INTO assets (id, name, ext, size, hash_blake3, rel_path, imported_at, updated_at)
                 VALUES ('aa000000000000000001','a','png',10,'dup','assets/aa/a.png',1,0),
                        ('aa000000000000000002','b','png',10,'dup','assets/aa/b.png',2,0),
                        ('aa000000000000000003','c','png',10,'uniq','assets/aa/c.png',3,0);",
            )?;
            Ok(())
        })
        .expect("seed");

        lib.with_reader(|conn| {
            let groups = exact_duplicate_groups(conn)?;
            assert_eq!(groups.len(), 1, "one duplicate group");
            let g = &groups[0];
            assert_eq!(g.len(), 2);
            // Oldest-first ordering by imported_at.
            assert_eq!(g[0].id, "aa000000000000000001");
            assert_eq!(g[1].id, "aa000000000000000002");
            Ok(())
        })
        .expect("reader");
    }

    #[test]
    fn clusters_transitively_and_drops_singletons() {
        // a~b (d=1), b~c (d=1) but a~c d=2 — still one cluster via b.
        let reps = vec![
            ("a".to_string(), 0b0000u64),
            ("b".to_string(), 0b0001u64),
            ("c".to_string(), 0b0011u64),
            ("far".to_string(), u64::MAX),
        ];
        let clusters = cluster_by_distance(&reps, 1);
        assert_eq!(clusters.len(), 1);
        assert_eq!(ids(&clusters[0]).len(), 3);
        assert!(!ids(&clusters[0]).contains(&"far"));
    }

    #[test]
    fn distance_zero_only_groups_identical() {
        let reps = vec![
            ("a".to_string(), 42u64),
            ("b".to_string(), 42u64),
            ("c".to_string(), 43u64),
        ];
        let clusters = cluster_by_distance(&reps, 0);
        assert_eq!(clusters.len(), 1);
        assert_eq!(ids(&clusters[0]), ["a", "b"]);
    }

    #[test]
    fn empty_input_yields_no_clusters() {
        assert!(cluster_by_distance(&[], 5).is_empty());
    }
}
