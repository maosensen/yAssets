//! Link import: turn a pasted URL into an asset.
//!
//! Two shapes, decided by the *final* response's `Content-Type` (see
//! `commands::url`): a direct media URL becomes a normal file asset, while an
//! HTML page becomes an Eagle-style **link asset** — its Open Graph cover image
//! stored as the managed file, with the page URL, title and description recorded
//! as provenance.
//!
//! This module is the pure core: HTML → `LinkMeta` (no IO) and small
//! `Content-Type` classifiers. The IO shell (fetch, redirect-following with
//! per-hop SSRF checks, download) lives in `commands`.

use dom_query::Document;
use reqwest::Url;

/// Open Graph / Twitter Card metadata scraped from a web page. Every URL field
/// is absolute (resolved against the page's final URL) and http(s)-only.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LinkMeta {
    pub title: Option<String>,
    pub description: Option<String>,
    /// The cover image (`og:image` / `twitter:image`), absolute.
    pub image_url: Option<String>,
    pub site_name: Option<String>,
    /// Best available site icon, absolute (`apple-touch-icon` preferred, then
    /// `icon`, then the origin's `/favicon.ico`).
    pub favicon_url: Option<String>,
}

/// Parse a page's `<head>` metadata. `base` is the page's final URL (after any
/// redirects), used to resolve relative image/icon URLs to absolute.
pub fn parse_link_meta(html: &str, base: &Url) -> LinkMeta {
    let doc = Document::from(html);

    // First non-empty `content` of any of the given meta selectors.
    let meta = |selectors: &[&str]| -> Option<String> {
        for sel in selectors {
            if let Some(v) = doc.select(sel).attr("content") {
                let v = v.trim();
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
        None
    };

    let title = meta(&[
        "meta[property='og:title']",
        "meta[name='og:title']",
        "meta[name='twitter:title']",
    ])
    .or_else(|| {
        let t = doc.select("title").text().trim().to_string();
        (!t.is_empty()).then_some(t)
    });

    let description = meta(&[
        "meta[property='og:description']",
        "meta[name='og:description']",
        "meta[name='twitter:description']",
        "meta[name='description']",
    ]);

    let site_name = meta(&["meta[property='og:site_name']", "meta[name='og:site_name']"]);

    let image_raw = meta(&[
        "meta[property='og:image']",
        "meta[name='og:image']",
        "meta[property='og:image:url']",
        "meta[name='twitter:image']",
        "meta[name='twitter:image:src']",
    ]);
    let image_url = image_raw.and_then(|raw| absolute_http_url(base, &raw));

    let favicon_url = favicon_href(&doc)
        .and_then(|raw| absolute_http_url(base, &raw))
        // Every site serves /favicon.ico at the origin as a last resort.
        .or_else(|| base.join("/favicon.ico").ok().map(|u| u.to_string()));

    LinkMeta {
        title,
        description,
        image_url,
        site_name,
        favicon_url,
    }
}

/// The best `<link rel=...>` icon href, in priority order. Returns the raw
/// (possibly relative) href; the caller resolves it against the page URL.
fn favicon_href(doc: &Document) -> Option<String> {
    for sel in [
        "link[rel='apple-touch-icon']",
        "link[rel='apple-touch-icon-precomposed']",
        "link[rel='icon']",
        "link[rel='shortcut icon']",
    ] {
        if let Some(href) = doc.select(sel).attr("href") {
            let href = href.trim();
            if !href.is_empty() {
                return Some(href.to_string());
            }
        }
    }
    None
}

/// Resolve `raw` against `base` and keep it only if it lands on http(s).
/// Rejects `data:`, `javascript:`, `about:` and other non-network schemes so a
/// scraped page can't point the downloader at something odd.
pub fn absolute_http_url(base: &Url, raw: &str) -> Option<String> {
    let joined = base.join(raw.trim()).ok()?;
    matches!(joined.scheme(), "http" | "https").then(|| joined.to_string())
}

/// Does this `Content-Type` name an HTML document (→ scrape it for a link)?
pub fn is_html_content_type(content_type: &str) -> bool {
    let base = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    base == "text/html" || base == "application/xhtml+xml"
}

/// Map a media `Content-Type` to a file extension (→ import it as a file
/// asset). `None` for anything we don't treat as directly-importable media
/// (including `text/html`, which routes to the link path instead).
pub fn media_ext_for_content_type(content_type: &str) -> Option<&'static str> {
    let base = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let ext = match base.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/bmp" | "image/x-ms-bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/svg+xml" => "svg",
        "image/heic" | "image/heif" => "heic",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/ogg" | "application/ogg" => "ogg",
        "audio/aac" => "aac",
        "application/pdf" => "pdf",
        _ => return None,
    };
    Some(ext)
}

/// Recognize a pasted string as a web URL, normalized for fetching.
///
/// Strict on purpose — `⌘V` runs this on *any* clipboard text, so it must not
/// mistake prose for a URL: the whole string must be a single token (no
/// whitespace) with a dotted host. A missing scheme becomes `https://`; a plain
/// `http://` is upgraded to `https://` (we only ever egress over TLS). Returns
/// `None` for anything that isn't a lone http(s) URL.
pub fn normalize_pasted_url(text: &str) -> Option<Url> {
    let trimmed = text.trim();
    // A lone URL has no inner whitespace/control chars.
    if trimmed.is_empty() || trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }

    let candidate = match trimmed.split_once("://") {
        Some((scheme, _)) => {
            let scheme = scheme.to_ascii_lowercase();
            if scheme == "https" {
                trimmed.to_string()
            } else if scheme == "http" {
                // Upgrade to TLS rather than reject — most sites redirect anyway.
                format!("https://{}", &trimmed[scheme.len() + 3..])
            } else {
                // mailto:, javascript:, file:, ftp:, … — not a web page.
                return None;
            }
        }
        // Bare `example.com/path` → assume https.
        None => format!("https://{trimmed}"),
    };

    let url = Url::parse(&candidate).ok()?;
    // Reject userinfo: a real paste rarely carries `user:pass@`, and it's how an
    // opaque scheme sneaks through — `mailto:a@b.com` becomes
    // `https://mailto:a@b.com` (user `mailto`, host `b.com`).
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    // A real web host is dotted (`example.com`); this also rejects `localhost`,
    // bare words, and `scheme:opaque` forms that slipped through.
    let host = url.host_str()?;
    if !host.contains('.') {
        return None;
    }
    Some(url)
}

/// A short, display-friendly host for a URL: the host without a leading `www.`.
pub fn host_label(url: &Url) -> String {
    url.host_str()
        .map(|h| h.strip_prefix("www.").unwrap_or(h).to_string())
        .unwrap_or_default()
}

/// A filename stem derived from a URL's last path segment (percent-decoded and
/// sanitized), for naming a downloaded media file. Falls back to the host.
pub fn filename_stem_from_url(url: &Url) -> String {
    let last = url
        .path_segments()
        .and_then(|mut segs| segs.rfind(|s| !s.is_empty()))
        .unwrap_or("");
    let decoded = percent_encoding::percent_decode_str(last)
        .decode_utf8_lossy()
        .to_string();
    // Drop a trailing extension; keep a safe, bounded stem.
    let stem = decoded.rsplit_once('.').map(|(s, _)| s).unwrap_or(&decoded);
    let clean: String = stem
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_'))
        .take(80)
        .collect();
    let clean = clean.trim();
    if clean.is_empty() {
        host_label(url)
    } else {
        clean.to_string()
    }
}

/// A generated cover for a link with no scrapable `og:image`: a calm two-tone
/// vertical gradient whose hue is derived from `seed` (usually the host), so
/// different sites get visibly different cards. The frontend overlays the title
/// and host on top. Returns encoded PNG bytes.
pub fn placeholder_png(seed: &str, width: u32, height: u32) -> Vec<u8> {
    // FNV-1a over the seed → a stable hue in [0, 360).
    let mut hash: u32 = 0x811c_9dc5;
    for b in seed.bytes() {
        hash ^= u32::from(b);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    let hue = (hash % 360) as f32;
    // Two muted shades of the same hue, top → bottom.
    let (r0, g0, b0) = hsv_to_rgb(hue, 0.32, 0.42);
    let (r1, g1, b1) = hsv_to_rgb(hue, 0.28, 0.24);

    let h = height.max(1);
    let img = image::RgbImage::from_fn(width.max(1), h, |_, y| {
        let t = y as f32 / (h - 1).max(1) as f32;
        let lerp = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t).round() as u8;
        image::Rgb([lerp(r0, r1), lerp(g0, g1), lerp(b0, b1)])
    });

    let mut buf = Vec::new();
    // Encoding a small synthetic gradient can't realistically fail; on the off
    // chance it does, an empty Vec makes the caller fall through to an error.
    let _ = img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png);
    buf
}

/// HSV (h in degrees, s/v in [0,1]) → 8-bit RGB.
fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let c = v * s;
    let h6 = (h / 60.0).rem_euclid(6.0);
    let x = c * (1.0 - (h6 % 2.0 - 1.0).abs());
    let (r, g, b) = match h6 as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = v - c;
    let to = |f: f32| ((f + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    (to(r), to(g), to(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("https://example.com/posts/hello").expect("base url")
    }

    #[test]
    fn parses_full_open_graph() {
        let html = r#"<!doctype html><html><head>
            <title>Fallback Title</title>
            <meta property="og:title" content="A Great Article">
            <meta property="og:description" content="Everything you need to know.">
            <meta property="og:site_name" content="Example Blog">
            <meta property="og:image" content="https://cdn.example.com/cover.jpg">
            <link rel="icon" href="/favicon.png">
        </head><body>...</body></html>"#;
        let meta = parse_link_meta(html, &base());
        assert_eq!(meta.title.as_deref(), Some("A Great Article"));
        assert_eq!(
            meta.description.as_deref(),
            Some("Everything you need to know.")
        );
        assert_eq!(meta.site_name.as_deref(), Some("Example Blog"));
        assert_eq!(
            meta.image_url.as_deref(),
            Some("https://cdn.example.com/cover.jpg")
        );
        assert_eq!(
            meta.favicon_url.as_deref(),
            Some("https://example.com/favicon.png")
        );
    }

    #[test]
    fn falls_back_to_twitter_card_then_title() {
        let html = r#"<html><head>
            <title>  Doc Title  </title>
            <meta name="twitter:image" content="//cdn.example.com/t.png">
            <meta name="description" content="plain description">
        </head></html>"#;
        let meta = parse_link_meta(html, &base());
        // No og:title/twitter:title → the <title> (trimmed) wins.
        assert_eq!(meta.title.as_deref(), Some("Doc Title"));
        assert_eq!(meta.description.as_deref(), Some("plain description"));
        // Protocol-relative URL resolves against the page's https scheme.
        assert_eq!(
            meta.image_url.as_deref(),
            Some("https://cdn.example.com/t.png")
        );
    }

    #[test]
    fn resolves_relative_image_and_defaults_favicon() {
        let html = r#"<html><head>
            <meta property="og:title" content="Rel">
            <meta property="og:image" content="../img/cover.webp">
        </head></html>"#;
        let meta = parse_link_meta(html, &base());
        assert_eq!(
            meta.image_url.as_deref(),
            Some("https://example.com/img/cover.webp")
        );
        // No <link rel=icon> → origin /favicon.ico.
        assert_eq!(
            meta.favicon_url.as_deref(),
            Some("https://example.com/favicon.ico")
        );
    }

    #[test]
    fn rejects_non_http_image_scheme() {
        let html = r#"<html><head>
            <meta property="og:image" content="data:image/png;base64,AAAA">
        </head></html>"#;
        let meta = parse_link_meta(html, &base());
        assert_eq!(meta.image_url, None);
    }

    #[test]
    fn handles_empty_and_malformed_html() {
        let meta = parse_link_meta("<not really><html", &base());
        assert_eq!(meta.title, None);
        assert_eq!(meta.image_url, None);
        // Even a page with no head still gets the default favicon.
        assert_eq!(
            meta.favicon_url.as_deref(),
            Some("https://example.com/favicon.ico")
        );
    }

    #[test]
    fn apple_touch_icon_wins_over_shortcut_icon() {
        let html = r#"<html><head>
            <link rel="shortcut icon" href="/small.ico">
            <link rel="apple-touch-icon" href="/touch.png">
        </head></html>"#;
        let meta = parse_link_meta(html, &base());
        assert_eq!(
            meta.favicon_url.as_deref(),
            Some("https://example.com/touch.png")
        );
    }

    #[test]
    fn normalizes_pasted_urls() {
        let ok = |s: &str| normalize_pasted_url(s).map(|u| u.to_string());
        // Bare domain gets https.
        assert_eq!(ok("example.com/a"), Some("https://example.com/a".into()));
        // http is upgraded to https.
        assert_eq!(
            ok("http://example.com/x?y=1"),
            Some("https://example.com/x?y=1".into())
        );
        // https passes through (with surrounding whitespace trimmed).
        assert_eq!(
            ok("  https://x.com/user/status/123  "),
            Some("https://x.com/user/status/123".into())
        );
    }

    #[test]
    fn rejects_non_url_text() {
        // Prose (has spaces) is never a URL, even if it contains one.
        assert!(normalize_pasted_url("see https://example.com here").is_none());
        // Undotted hosts (localhost, bare words) are rejected.
        assert!(normalize_pasted_url("localhost:3000").is_none());
        assert!(normalize_pasted_url("just some text").is_none());
        assert!(normalize_pasted_url("hello").is_none());
        // Non-web schemes are rejected.
        assert!(normalize_pasted_url("mailto:a@b.com").is_none());
        assert!(normalize_pasted_url("javascript:alert(1)").is_none());
        assert!(normalize_pasted_url("").is_none());
    }

    #[test]
    fn derives_host_and_filename() {
        let u = Url::parse("https://www.example.com/dir/My%20Photo.JPG").unwrap();
        assert_eq!(host_label(&u), "example.com");
        assert_eq!(filename_stem_from_url(&u), "My Photo");
        // No usable path segment → host.
        let root = Url::parse("https://cdn.example.com/").unwrap();
        assert_eq!(filename_stem_from_url(&root), "cdn.example.com");
    }

    #[test]
    fn placeholder_is_a_valid_png() {
        let bytes = placeholder_png("example.com", 64, 40);
        assert!(!bytes.is_empty());
        // PNG magic number.
        assert_eq!(
            &bytes[..8],
            &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        );
        // Decodes back to the requested size.
        let img = image::load_from_memory(&bytes).expect("decode png");
        assert_eq!((img.width(), img.height()), (64, 40));
        // Different seeds → different covers.
        assert_ne!(bytes, placeholder_png("other.com", 64, 40));
    }

    #[test]
    fn classifies_content_types() {
        assert!(is_html_content_type("text/html; charset=utf-8"));
        assert!(is_html_content_type("application/xhtml+xml"));
        assert!(!is_html_content_type("image/png"));

        assert_eq!(media_ext_for_content_type("image/jpeg"), Some("jpg"));
        assert_eq!(
            media_ext_for_content_type("image/webp; charset=binary"),
            Some("webp")
        );
        assert_eq!(media_ext_for_content_type("video/mp4"), Some("mp4"));
        assert_eq!(media_ext_for_content_type("application/pdf"), Some("pdf"));
        // HTML is not directly-importable media — it takes the link path.
        assert_eq!(media_ext_for_content_type("text/html"), None);
        assert_eq!(media_ext_for_content_type("application/json"), None);
    }
}
