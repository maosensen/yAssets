//! Discover commands: search third-party image sources and import selected
//! results into the library. All network I/O lives here (via the shared reqwest
//! client in `AppState`); the webview only hotlinks provider thumbnails.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::import::{process_file_with_source, FileOutcome};
use crate::library::new_id;
use crate::sources::{
    openverse, pexels, pixabay, wallhaven, SourceFilters, SourceItem, SourceProvider,
    SourceSearchResult,
};
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
        SourceProvider::Pixabay => {
            pixabay::search(&client, &query, page, &filters, api_key.as_deref()).await
        }
        SourceProvider::Openverse => {
            openverse::search(&client, &query, page, &filters, api_key.as_deref()).await
        }
        SourceProvider::Pexels => {
            pexels::search(&client, &query, page, &filters, api_key.as_deref()).await
        }
    }
}

/// The credit line stored on an imported asset's note. Prefer the provider's
/// ready-made attribution (Openverse/Pexels); otherwise compose from author +
/// license. `None` when the provider supplies neither (Wallhaven).
fn attribution_note(item: &SourceItem) -> Option<String> {
    if let Some(attribution) = item.attribution.as_deref().filter(|a| !a.is_empty()) {
        return Some(attribution.to_string());
    }
    match (
        item.author.as_deref().filter(|a| !a.is_empty()),
        item.license.as_deref().filter(|l| !l.is_empty()),
    ) {
        (Some(author), Some(license)) => Some(format!("By {author} · {license}")),
        (Some(author), None) => Some(format!("By {author}")),
        (None, Some(license)) => Some(license.to_string()),
        (None, None) => None,
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
        let note = attribution_note(&item);
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let tmp = std::env::temp_dir().join(format!("yassets-dl-{}.{ext}", new_id()));
            // Always remove the temp, even if the write itself fails partway
            // (a `?` here would leak it).
            let result = match std::fs::write(&tmp, &bytes) {
                Ok(()) => process_file_with_source(
                    &lib,
                    &tmp,
                    folder.as_deref(),
                    &seen,
                    false,
                    Some(source.as_str()),
                    note.as_deref(),
                ),
                Err(err) => Err(format!("temp write failed: {err}")),
            };
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
    // The URL comes from a provider response — treat it as untrusted. Require
    // https to a public host: this (plus the client's no-redirect + https-only
    // policy) blocks SSRF to loopback/link-local/private/plaintext targets.
    let parsed =
        reqwest::Url::parse(url).map_err(|_| AppError::Conflict("invalid source URL".into()))?;
    if parsed.scheme() != "https" {
        return Err(AppError::Conflict("refusing non-https source URL".into()));
    }
    if host_is_blocked(parsed.host_str()) {
        return Err(AppError::Conflict("refusing private/loopback host".into()));
    }

    let mut resp = client.get(parsed).send().await?;
    // No-redirect client: a 3xx (or any non-2xx) is a failure, not a follow.
    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "unexpected status: {}",
            resp.status()
        )));
    }
    // Reject early if the server declares an over-limit size…
    if let Some(len) = resp.content_length() {
        if len > MAX_DOWNLOAD_BYTES {
            return Err(AppError::Conflict("remote file too large".into()));
        }
    }
    // …and enforce the cap while streaming, so an absent/lying Content-Length
    // can't buffer unbounded bytes into memory.
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        if buf.len() as u64 + chunk.len() as u64 > MAX_DOWNLOAD_BYTES {
            return Err(AppError::Conflict("remote file too large".into()));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// Block loopback / private / link-local / unspecified hosts (SSRF defense).
/// Domain names other than "localhost" are allowed (public providers); we can't
/// resolve them here without a DNS round-trip, and the no-redirect + https-only
/// client already prevents the classic redirect-to-internal pivot.
fn host_is_blocked(host: Option<&str>) -> bool {
    let Some(host) = host else {
        return true;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    // `host_str` keeps IPv6 brackets — strip them before parsing.
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    match bare.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => ipv4_blocked(&ip),
        Ok(std::net::IpAddr::V6(ip)) => {
            // An IPv4-mapped literal (::ffff:a.b.c.d) reaches the same target as
            // the bare IPv4 — canonicalize and apply the IPv4 rules so it can't
            // be used to smuggle a private/metadata address past the guard.
            if let Some(v4) = ip.to_ipv4_mapped() {
                return ipv4_blocked(&v4);
            }
            ip.is_loopback()
                || ip.is_unspecified()
                || is_ipv6_unique_local(&ip)
                || is_ipv6_link_local(&ip)
        }
        // Not an IP literal → a domain; allow (public provider CDN).
        Err(_) => false,
    }
}

/// Loopback / private / link-local / unspecified IPv4 (SSRF targets).
fn ipv4_blocked(ip: &std::net::Ipv4Addr) -> bool {
    ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified()
}

/// IPv6 unique-local `fc00::/7` (the ULA range, analogous to IPv4 private).
/// `Ipv6Addr::is_unique_local` is still unstable, so match the prefix directly.
fn is_ipv6_unique_local(ip: &std::net::Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xfe00) == 0xfc00
}

/// IPv6 link-local `fe80::/10`. `is_unicast_link_local` is unstable — match the
/// prefix directly.
fn is_ipv6_link_local(ip: &std::net::Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xffc0) == 0xfe80
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

#[cfg(test)]
mod tests {
    use super::{host_is_blocked, sanitize_ext};

    #[test]
    fn blocks_loopback_private_and_metadata_hosts() {
        for host in [
            "localhost",
            "127.0.0.1",
            "169.254.169.254", // cloud metadata
            "10.0.0.5",
            "192.168.1.2",
            "172.16.0.1",
            "0.0.0.0",
            "[::1]",
            "[::]",
            // IPv4-mapped IPv6 must not smuggle a private/metadata target past
            // the guard.
            "[::ffff:127.0.0.1]",
            "[::ffff:169.254.169.254]",
            "[::ffff:10.0.0.1]",
            // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
            "[fd00::1]",
            "[fc00::1]",
            "[fe80::1]",
        ] {
            assert!(host_is_blocked(Some(host)), "should block {host}");
        }
        assert!(host_is_blocked(None));
    }

    #[test]
    fn allows_public_hosts() {
        assert!(!host_is_blocked(Some("w.wallhaven.cc")));
        assert!(!host_is_blocked(Some("th.wallhaven.cc")));
        assert!(!host_is_blocked(Some("8.8.8.8")));
        // A public IPv6 literal (Cloudflare DNS) is allowed.
        assert!(!host_is_blocked(Some("[2606:4700:4700::1111]")));
    }

    #[test]
    fn sanitize_ext_falls_back_and_strips() {
        assert_eq!(sanitize_ext("PNG"), "png");
        assert_eq!(sanitize_ext("../evil"), "evil");
        assert_eq!(sanitize_ext(""), "jpg");
    }
}
