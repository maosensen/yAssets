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

/// Scan the whole library for exact and visual duplicates.
#[tauri::command]
#[specta::specta]
pub async fn scan_duplicates(state: tauri::State<'_, AppState>) -> AppResult<DuplicateScan> {
    let library = state.current_library()?;
    library
        .read(|conn| {
            // --- Exact: one query, grouped in memory by hash. -------------
            let mut stmt = conn.prepare(&format!(
                "SELECT {SUMMARY_COLS}, hash_blake3 FROM assets
                 WHERE deleted_at IS NULL AND hash_blake3 IN (
                   SELECT hash_blake3 FROM assets
                   WHERE deleted_at IS NULL
                   GROUP BY hash_blake3 HAVING COUNT(*) > 1
                 )
                 ORDER BY hash_blake3, imported_at"
            ))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((summary_from_row(row)?, row.get::<_, String>(9)?))
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
        })
        .await
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
    use super::cluster_by_distance;

    fn ids(cluster: &[String]) -> Vec<&str> {
        cluster.iter().map(String::as_str).collect()
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
