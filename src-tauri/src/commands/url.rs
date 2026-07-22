//! Paste-a-URL import: turn a clipboard URL into an asset.
//!
//! `⌘V` on the grid runs `clipboard_url` first; a recognized URL is imported via
//! `import_url` (all network in Rust, like Discover). A direct media URL becomes
//! a normal file asset; a web page becomes an Eagle-style **link asset** whose
//! managed file is the page's Open Graph cover, with the page recorded in `url`.
//!
//! Security mirrors `commands::sources`: https-only egress, per-hop SSRF host
//! checks while following redirects, and a streaming size cap.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION, USER_AGENT};
use reqwest::Url;
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::sources::host_is_blocked;
use crate::error::{AppError, AppResult};
use crate::import::{process_file_with_meta, FileOutcome};
use crate::library::{new_id, Library};
use crate::link;
use crate::state::AppState;

/// The single reused in-app browser window for opening link assets. A remote
/// (External) URL loaded as a window's top document is NOT subject to
/// `X-Frame-Options` (that only blocks iframing), so sites that refuse
/// embedding — X, Google, GitHub — still render here. The window matches no
/// capability, so the loaded page gets none of the app's IPC commands.
const LINK_WINDOW_LABEL: &str = "link-viewer";

/// Bounded redirect chain — enough for the common `http→https` / `apex→www`
/// hops without becoming a redirect-loop amplifier.
const MAX_REDIRECTS: u32 = 5;
/// HTML we scrape for metadata is small; cap hard so a hostile "page" can't
/// stream gigabytes into memory.
const MAX_HTML_BYTES: u64 = 4 * 1024 * 1024;
/// A directly-imported media file (matches the Discover downloader's cap).
const MAX_MEDIA_BYTES: u64 = 100 * 1024 * 1024;
/// A link cover image.
const MAX_COVER_BYTES: u64 = 25 * 1024 * 1024;
/// A realistic UA for page/cover fetches — many sites serve no Open Graph tags
/// (or no page at all) to unknown agents. Used only for these read-only GETs.
const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/// Result of a single URL import, for the toast.
#[derive(Debug, Serialize, specta::Type)]
pub struct UrlImport {
    /// `"link"` (a bookmark) or `"media"` (a downloaded file).
    pub kind: String,
    /// Display title — the page title, or the media filename.
    pub title: String,
    /// Short host, e.g. `x.com`.
    pub host: String,
    /// The asset was already in the library (a link with the same URL, or media
    /// with identical content).
    pub duplicate: bool,
}

/// If the clipboard holds *only* a web URL (no copied files or bitmap, which
/// `import_clipboard` handles and which take priority), return it normalized.
/// `⌘V` calls this before `import_clipboard`; `None` means "not a URL paste".
#[tauri::command]
#[specta::specta]
pub async fn clipboard_url() -> AppResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(clipboard_url_text)
        .await
        .map_err(|e| {
            log::error!("clipboard url task failed: {e}");
            AppError::Internal
        })
}

fn clipboard_url_text() -> Option<String> {
    use clipboard_rs::common::RustImage;
    use clipboard_rs::{Clipboard, ClipboardContext};

    let ctx = ClipboardContext::new().ok()?;
    // Files and bitmaps take priority — let import_clipboard handle those.
    if ctx.get_files().map(|f| !f.is_empty()).unwrap_or(false) {
        return None;
    }
    if ctx.get_image().map(|i| !i.is_empty()).unwrap_or(false) {
        return None;
    }
    let text = ctx.get_text().ok()?;
    link::normalize_pasted_url(&text).map(|u| u.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn import_url(
    url: String,
    folder_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<UrlImport> {
    let client = state.http();
    let library = state.current_library()?;
    import_url_core(&client, &library, &url, folder_id, None).await
}

/// The full URL-import flow, shared by the `import_url` command (⌘V) and the
/// Collect API (`collect::server`). `source_page` overrides the recorded
/// provenance for the media branch — a right-clicked image's `source` should
/// be the page it was found on, not the CDN URL of its bytes.
pub(crate) async fn import_url_core(
    client: &reqwest::Client,
    library: &Arc<Library>,
    url: &str,
    folder_id: Option<String>,
    source_page: Option<String>,
) -> AppResult<UrlImport> {
    let start = link::normalize_pasted_url(url)
        .ok_or_else(|| AppError::Conflict("not a valid web URL".into()))?;

    let (final_url, resp) = follow_to_final(client, start, MAX_REDIRECTS).await?;
    let content_type = header_str(&resp, CONTENT_TYPE);
    let host = link::host_label(&final_url);

    if let Some(ext) = link::media_ext_for_content_type(&content_type) {
        import_media(resp, library, &final_url, folder_id, ext, host, source_page).await
    } else {
        let meta = if link::is_html_content_type(&content_type) {
            let bytes = read_body_capped(resp, MAX_HTML_BYTES).await?;
            // Decode by the page's declared charset (Content-Type / <meta>) so
            // legacy Shift-JIS / EUC-JP / GBK titles aren't mojibake.
            let html = link::decode_html(&bytes, &content_type);
            link::parse_link_meta(&html, &final_url)
        } else {
            // Neither media nor HTML (e.g. a JSON endpoint): still bookmark it,
            // with URL-only metadata and a generated cover.
            link::LinkMeta {
                favicon_url: final_url.join("/favicon.ico").ok().map(|u| u.to_string()),
                ..Default::default()
            }
        };
        // A page is its own provenance — `source_page` only applies to media.
        import_link(client, library, &final_url, folder_id, meta, host).await
    }
}

/// Open a link asset's page in the in-app browser window (reused across links).
/// Renders the live site — it's a top-level webview load, not an iframe.
#[tauri::command]
#[specta::specta]
pub fn open_link_window(
    url: String,
    title: Option<String>,
    app: tauri::AppHandle,
) -> AppResult<()> {
    let parsed = Url::parse(&url).map_err(|_| AppError::Conflict("invalid url".into()))?;
    // Same SSRF posture as download()/guard(): a stored asset.url is untrusted
    // (writable via update_asset / an imported library), so refuse non-web
    // schemes and private/loopback/link-local/metadata hosts.
    if !viewer_url_allowed(&parsed) {
        return Err(AppError::Conflict(
            "refusing non-web or private-host URL".into(),
        ));
    }
    let title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| link::host_label(&parsed));

    // Reuse one window: subsequent opens navigate it, like a single browser tab.
    if let Some(win) = app.get_webview_window(LINK_WINDOW_LABEL) {
        win.navigate(parsed).map_err(window_err)?;
        let _ = win.set_title(&title);
        let _ = win.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, LINK_WINDOW_LABEL, WebviewUrl::External(parsed))
        // Re-check every navigation (redirects + in-page clicks), not just the
        // initial URL — the engine follows redirects on its own, so a public
        // page that 3xx-redirects to a private host would otherwise slip past.
        // Nav-variant so WebView2's startup `about:blank` isn't cancelled (that
        // left the link window blank on Windows).
        .on_navigation(viewer_nav_allowed)
        .title(&title)
        .inner_size(1200.0, 820.0)
        .center()
        .build()
        .map_err(window_err)?;
    Ok(())
}

/// The in-app viewer only loads http(s) on public hosts. Blocks private /
/// loopback / link-local / unspecified / metadata hosts (SSRF), applied to both
/// the URL we are handed and every subsequent navigation via `on_navigation`.
fn viewer_url_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && !host_is_blocked(url.host_str())
}

/// Navigation gate for the live viewer (`on_navigation`, fires on every
/// in-webview navigation). Same SSRF block as `viewer_url_allowed` for real
/// web fetches, but PERMITS engine-internal non-web schemes: WebView2 (Windows)
/// fires a startup navigation to `about:blank`, and returning false there
/// cancels it, leaving the window blank (WKWebView on macOS doesn't emit it, so
/// the bug was Windows-only). Only http(s) to a private host is ever blocked.
fn viewer_nav_allowed(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => !host_is_blocked(url.host_str()),
        _ => true,
    }
}

fn window_err(err: tauri::Error) -> AppError {
    log::error!("link window failed: {err}");
    AppError::Internal
}

/// Direct-media branch: the response body *is* the asset.
#[allow(clippy::too_many_arguments)]
async fn import_media(
    resp: reqwest::Response,
    library: &Arc<Library>,
    final_url: &Url,
    folder_id: Option<String>,
    ext: &str,
    host: String,
    source_page: Option<String>,
) -> AppResult<UrlImport> {
    let bytes = read_body_capped(resp, MAX_MEDIA_BYTES).await?;
    let title = link::filename_stem_from_url(final_url);
    let source = source_page.unwrap_or_else(|| final_url.to_string());

    let lib = Arc::clone(library);
    let ext = ext.to_string();
    let name = title.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        write_and_process(
            &lib,
            &bytes,
            &ext,
            folder_id.as_deref(),
            Some(&source),
            None,
            "file",
            Some(&name),
            false,
        )
    })
    .await
    .map_err(|_| AppError::Internal)??;

    Ok(UrlImport {
        kind: "media".into(),
        title,
        host,
        duplicate: matches!(outcome, FileOutcome::Duplicate { .. }),
    })
}

/// Web-page branch: store the Open Graph cover as a link asset.
async fn import_link(
    client: &reqwest::Client,
    library: &Arc<Library>,
    page_url: &Url,
    folder_id: Option<String>,
    meta: link::LinkMeta,
    host: String,
) -> AppResult<UrlImport> {
    let page = page_url.to_string();
    let title = meta
        .title
        .as_deref()
        .map(|t| truncate(t, 200))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| host.clone());

    // Dedupe by page URL — two different pages can share a cover image, so
    // content-hash dedupe is the wrong axis for bookmarks.
    let existing = {
        let page = page.clone();
        library.with_reader(move |conn| {
            Ok(conn
                .query_row(
                    "SELECT 1 FROM assets
                       WHERE url = ?1 AND kind = 'link' AND deleted_at IS NULL LIMIT 1",
                    [&page],
                    |_| Ok(()),
                )
                .optional()?
                .is_some())
        })?
    };
    if existing {
        return Ok(UrlImport {
            kind: "link".into(),
            title,
            host,
            duplicate: true,
        });
    }

    // Cover: the og:image, else a generated card colored by host.
    let (cover_bytes, cover_ext) = match meta.image_url.as_deref() {
        Some(img) => download_cover(client, img)
            .await
            .unwrap_or_else(|_| (link::placeholder_png(&host, 1200, 630), "png".into())),
        None => (link::placeholder_png(&host, 1200, 630), "png".into()),
    };
    let note = meta.description.as_deref().map(|d| truncate(d, 500));

    let lib = Arc::clone(library);
    let name = title.clone();
    tauri::async_runtime::spawn_blocking(move || {
        write_and_process(
            &lib,
            &cover_bytes,
            &cover_ext,
            folder_id.as_deref(),
            Some(&page),
            note.as_deref(),
            "link",
            Some(&name),
            // Bypass content-hash dedupe: identical placeholder covers (or a
            // shared og:image) must not collapse distinct bookmarks. URL dedupe
            // above is the real guard.
            true,
        )
    })
    .await
    .map_err(|_| AppError::Internal)??;

    Ok(UrlImport {
        kind: "link".into(),
        title,
        host,
        duplicate: false,
    })
}

/// Write bytes to a temp file, run the import pipeline, then delete the temp.
/// Shared with the Collect API's `/api/collect/data` handler.
#[allow(clippy::too_many_arguments)]
pub(crate) fn write_and_process(
    library: &Library,
    bytes: &[u8],
    ext: &str,
    folder_id: Option<&str>,
    source: Option<&str>,
    note: Option<&str>,
    kind: &str,
    name_override: Option<&str>,
    keep_duplicates: bool,
) -> AppResult<FileOutcome> {
    let seen = Mutex::new(HashSet::<String>::new());
    let tmp = std::env::temp_dir().join(format!("yassets-url-{}.{ext}", new_id()));
    let result = match std::fs::write(&tmp, bytes) {
        Ok(()) => process_file_with_meta(
            library,
            &tmp,
            folder_id,
            &seen,
            keep_duplicates,
            source,
            note,
            kind,
            name_override,
        )
        .map_err(|e| {
            log::warn!("url import processing failed: {e}");
            AppError::Io(e)
        }),
        Err(e) => Err(AppError::Io(format!("temp write failed: {e}"))),
    };
    let _ = std::fs::remove_file(&tmp);
    result
}

/// Download a link cover, following redirects. Returns bytes + a file extension;
/// errors (non-image, oversize, blocked host) let the caller fall back to a
/// generated placeholder.
async fn download_cover(client: &reqwest::Client, cover_url: &str) -> AppResult<(Vec<u8>, String)> {
    let url = Url::parse(cover_url).map_err(|_| AppError::Conflict("bad cover url".into()))?;
    let (final_url, resp) = follow_to_final(client, url, MAX_REDIRECTS).await?;
    let content_type = header_str(&resp, CONTENT_TYPE);

    // Only accept an image; anything else → placeholder.
    let ext = link::media_ext_for_content_type(&content_type)
        .map(str::to_string)
        .or_else(|| image_ext_from_path(&final_url))
        .ok_or_else(|| AppError::Conflict("cover is not an image".into()))?;

    let bytes = read_body_capped(resp, MAX_COVER_BYTES).await?;
    Ok((bytes, ext))
}

/// GET `start`, following up to `max_redirects` hops, re-checking https + host
/// on every hop (SSRF defense). Returns the final URL and a *successful*
/// (2xx) response ready to stream.
async fn follow_to_final(
    client: &reqwest::Client,
    start: Url,
    max_redirects: u32,
) -> AppResult<(Url, reqwest::Response)> {
    let mut url = start;
    for _ in 0..=max_redirects {
        guard(&url)?;
        let resp = client
            .get(url.clone())
            .header(USER_AGENT, BROWSER_UA)
            .header(ACCEPT, "text/html,application/xhtml+xml,image/*,*/*;q=0.8")
            .send()
            .await?;
        let status = resp.status();
        if status.is_redirection() {
            let location = resp
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| AppError::Network("redirect without a location".into()))?;
            // Resolve relative redirects against the current URL; the next
            // loop iteration re-guards scheme + host before sending.
            url = url
                .join(location)
                .map_err(|_| AppError::Network("invalid redirect target".into()))?;
            continue;
        }
        if !status.is_success() {
            return Err(AppError::Network(format!("unexpected status: {status}")));
        }
        return Ok((url, resp));
    }
    Err(AppError::Network("too many redirects".into()))
}

/// https-only + private/loopback host block, applied before every request.
fn guard(url: &Url) -> AppResult<()> {
    if url.scheme() != "https" {
        return Err(AppError::Conflict("refusing non-https URL".into()));
    }
    if host_is_blocked(url.host_str()) {
        return Err(AppError::Conflict("refusing private/loopback host".into()));
    }
    Ok(())
}

/// Stream a response body into memory, enforcing `max` even when the server
/// lies about (or omits) Content-Length.
async fn read_body_capped(mut resp: reqwest::Response, max: u64) -> AppResult<Vec<u8>> {
    if let Some(len) = resp.content_length() {
        if len > max {
            return Err(AppError::Conflict("remote file too large".into()));
        }
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        if buf.len() as u64 + chunk.len() as u64 > max {
            return Err(AppError::Conflict("remote file too large".into()));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

fn header_str(resp: &reqwest::Response, name: reqwest::header::HeaderName) -> String {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

/// Image file extension from a URL path (fallback when a cover response omits a
/// usable Content-Type). `None` for non-image / extension-less paths.
fn image_ext_from_path(url: &Url) -> Option<String> {
    let last = url.path_segments()?.next_back()?;
    let ext = last.rsplit_once('.')?.1.to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "avif" | "bmp" | "tiff" | "svg" | "ico"
    )
    .then_some(ext)
}

/// Truncate to at most `max` chars on a char boundary, trimming whitespace.
fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars()
            .take(max)
            .collect::<String>()
            .trim_end()
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_respects_char_boundaries() {
        assert_eq!(truncate("  hello  ", 10), "hello");
        assert_eq!(truncate("hello world", 5), "hello");
        // Multibyte: never splits a char.
        let s = "日本語のタイトル";
        assert_eq!(truncate(s, 3), "日本語");
    }

    #[test]
    fn image_ext_from_path_only_images() {
        let img = Url::parse("https://cdn.example.com/a/b/cover.PNG").unwrap();
        assert_eq!(image_ext_from_path(&img).as_deref(), Some("png"));
        let page = Url::parse("https://example.com/article").unwrap();
        assert_eq!(image_ext_from_path(&page), None);
        let doc = Url::parse("https://example.com/file.pdf").unwrap();
        assert_eq!(image_ext_from_path(&doc), None);
    }

    #[test]
    fn viewer_blocks_private_hosts_and_non_web_schemes() {
        let allow = |s: &str| viewer_url_allowed(&Url::parse(s).unwrap());
        // Public http(s) pages are fine (it's a browser view).
        assert!(allow("https://x.com/user/status/1"));
        assert!(allow("http://example.com/page"));
        // SSRF targets are blocked regardless of scheme.
        assert!(!allow("http://169.254.169.254/latest/meta-data/"));
        assert!(!allow("http://127.0.0.1:8080/"));
        assert!(!allow("http://192.168.1.1/apply.cgi"));
        assert!(!allow("https://localhost/admin"));
        // Non-web schemes are refused.
        assert!(!allow("file:///etc/passwd"));
    }

    #[test]
    fn viewer_nav_permits_internal_schemes_but_keeps_ssrf_block() {
        let allow = |s: &str| viewer_nav_allowed(&Url::parse(s).unwrap());
        // WebView2's startup navigation must pass, or the window stays blank.
        assert!(allow("about:blank"));
        assert!(allow("data:text/html,hi"));
        // Real public pages load.
        assert!(allow("https://x.com/user/status/1"));
        // SSRF targets stay blocked on real web navigations (redirects too).
        assert!(!allow("http://127.0.0.1:8080/"));
        assert!(!allow("http://169.254.169.254/latest/meta-data/"));
    }

    #[test]
    fn guard_blocks_non_https_and_private_hosts() {
        assert!(guard(&Url::parse("http://example.com").unwrap()).is_err());
        assert!(guard(&Url::parse("https://127.0.0.1/x").unwrap()).is_err());
        assert!(guard(&Url::parse("https://169.254.169.254/latest").unwrap()).is_err());
        assert!(guard(&Url::parse("https://example.com/x").unwrap()).is_ok());
    }
}
