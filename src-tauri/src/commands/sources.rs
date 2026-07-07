//! Discover commands: search third-party image sources and import selected
//! results into the library. All network I/O lives here (via the shared reqwest
//! client in `AppState`); the webview only hotlinks provider thumbnails.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::import::{process_file_with_source, FileOutcome};
use crate::library::new_id;
use crate::sources::{wallhaven, SourceFilters, SourceItem, SourceProvider, SourceSearchResult};
use crate::state::AppState;

/// Hard cap on a single download — defense against a hostile/huge remote file.
const MAX_DOWNLOAD_BYTES: u64 = 100 * 1024 * 1024;

#[tauri::command]
#[specta::specta]
pub async fn search_source(
    provider: SourceProvider,
    query: String,
    page: u32,
    filters: SourceFilters,
    api_key: Option<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<SourceSearchResult> {
    let client = state.http();
    match provider {
        SourceProvider::Wallhaven => {
            wallhaven::search(&client, &query, page, &filters, api_key.as_deref()).await
        }
    }
}

/// Outcome tally for a batch "Add to Library".
#[derive(Debug, Default, Serialize, specta::Type)]
pub struct ImportSummary {
    pub imported: u32,
    /// Batch-local repeats (the same item twice in one add).
    pub skipped: u32,
    /// Already in the library (exact content) — the existing asset is kept.
    pub duplicates: u32,
    pub failed: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn import_source_items(
    items: Vec<SourceItem>,
    folder_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<ImportSummary> {
    let library = state.current_library()?;
    let client = state.http();
    // One dedupe set per batch, so adding the same image twice in one action
    // lands once (mirrors the drag-drop import pipeline).
    let seen = Arc::new(Mutex::new(HashSet::<String>::new()));
    let mut summary = ImportSummary::default();

    for item in items {
        let bytes = match download(&client, &item.full_url).await {
            Ok(bytes) => bytes,
            Err(err) => {
                log::warn!("source download failed for {}: {err:?}", item.full_url);
                summary.failed += 1;
                continue;
            }
        };

        // Hash / copy / thumbnail / insert is blocking (CPU + disk + DB) — run
        // it off the async runtime. `process_file_with_source` records the
        // provider page as the asset's `source` and reuses the library-wide
        // dedupe, so re-adding a known image is a no-op.
        let lib = Arc::clone(&library);
        let seen = Arc::clone(&seen);
        let folder = folder_id.clone();
        let ext = sanitize_ext(&item.ext);
        let source = item.source_page_url.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let tmp = std::env::temp_dir().join(format!("yassets-dl-{}.{ext}", new_id()));
            std::fs::write(&tmp, &bytes).map_err(|err| format!("temp write failed: {err}"))?;
            let result = process_file_with_source(
                &lib,
                &tmp,
                folder.as_deref(),
                &seen,
                false,
                Some(source.as_str()),
            );
            let _ = std::fs::remove_file(&tmp);
            result
        })
        .await
        .map_err(|_| AppError::Internal)?;

        match outcome {
            Ok(FileOutcome::Imported) => summary.imported += 1,
            Ok(FileOutcome::Skipped) => summary.skipped += 1,
            Ok(FileOutcome::Duplicate { .. }) => summary.duplicates += 1,
            Err(err) => {
                log::warn!("source import failed: {err}");
                summary.failed += 1;
            }
        }
    }
    Ok(summary)
}

async fn download(client: &reqwest::Client, url: &str) -> AppResult<Vec<u8>> {
    // Only fetch over TLS. The URL comes from a provider's own response, but
    // this keeps a spoofed/compromised result from reaching http / file / an
    // internal host.
    if !url.starts_with("https://") {
        return Err(AppError::Conflict("refusing non-https source URL".into()));
    }
    let resp = client.get(url).send().await?.error_for_status()?;
    if let Some(len) = resp.content_length() {
        if len > MAX_DOWNLOAD_BYTES {
            return Err(AppError::Conflict("remote file too large".into()));
        }
    }
    let bytes = resp.bytes().await?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err(AppError::Conflict("remote file too large".into()));
    }
    Ok(bytes.to_vec())
}

/// Keep only a short alphanumeric extension (mirrors the import pipeline).
fn sanitize_ext(ext: &str) -> String {
    let clean: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(16)
        .collect();
    if clean.is_empty() {
        "jpg".to_string()
    } else {
        clean.to_lowercase()
    }
}
