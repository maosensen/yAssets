//! Custom async `yasset://` protocol serving library media to the WebView.
//!
//! Routes (path is percent-decoded before routing; `convertFileSrc` on the
//! frontend encodes it and handles the platform URL shape — macOS/Linux
//! `yasset://localhost/<route>/<id>`, Windows `http://yasset.localhost/...`):
//!
//! - `thumb/<id>` → `<library>/thumbs/<shard>/<id>.webp` — hot path, zero DB,
//!   the location is derived purely from the id.
//! - `file/<id>`  → original file (one DB lookup for `rel_path`/mime).
//!   Supports HTTP Range (`206 Partial Content`) so `<video>`/`<audio>` can
//!   seek and large files stream in bounded chunks instead of one giant read.
//!
//! Security model: this handler is the only bridge from the WebView to library
//! files. The id whitelist (`^[0-9a-z]{10,32}$`) is the complete input surface —
//! no user-controlled path segments ever reach a filesystem join, so path
//! traversal is structurally impossible. The frontend never sees absolute paths.
//!
//! CSP: `img-src`/`media-src`/`connect-src` in tauri.conf.json must list
//! `yasset:` and `http://yasset.localhost` for the two platform URL shapes.

use std::io::{Read, Seek, SeekFrom};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Manager, UriSchemeContext, UriSchemeResponder};

use crate::state::AppState;

/// Handler for `register_asynchronous_uri_scheme_protocol("yasset", …)`.
///
/// Returns immediately; the file read happens on a blocking thread and the
/// response is delivered through `responder` when ready.
pub fn handler(
    ctx: UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let response = respond(&app, &request).await;
        responder.respond(response);
    });
}

async fn respond(app: &tauri::AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // Decode first, then route — convertFileSrc percent-encodes the whole
    // path, so the raw URI may arrive as `/thumb%2F<id>`.
    let decoded = percent_decode_str(request.uri().path()).decode_utf8_lossy();
    let mut segments = decoded.trim_start_matches('/').splitn(2, '/');
    let route = segments.next().unwrap_or_default();
    let id = segments.next().unwrap_or_default();

    if !is_valid_id(id) {
        return status(StatusCode::BAD_REQUEST);
    }

    let head_only = request.method() == Method::HEAD;
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    match route {
        "thumb" => serve_thumb(app, id, head_only).await,
        "file" => serve_file(app, id, range, head_only).await,
        _ => status(StatusCode::NOT_FOUND),
    }
}

/// What the blocking reader produced for a `file/<id>` request.
enum ServedFile {
    Full {
        body: Vec<u8>,
        size: u64,
    },
    Partial {
        body: Vec<u8>,
        start: u64,
        end: u64,
        size: u64,
    },
    Unsatisfiable {
        size: u64,
    },
}

/// Original file: one reader-pool lookup for `rel_path` + mime, then a
/// blocking (ranged) read. Managed files never mutate in place, so immutable
/// caching applies here too.
async fn serve_file(
    app: &tauri::AppHandle,
    id: &str,
    range: Option<String>,
    head_only: bool,
) -> Response<Vec<u8>> {
    let Ok(library) = app.state::<AppState>().current_library() else {
        return status(StatusCode::SERVICE_UNAVAILABLE);
    };

    let id_owned = id.to_string();
    let row = library
        .read(move |conn| {
            Ok(conn
                .query_row(
                    "SELECT rel_path, mime FROM assets WHERE id = ?1",
                    [id_owned.as_str()],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .ok())
        })
        .await;

    match row {
        Ok(Some((rel_path, mime))) => {
            let path = library.resolve_rel(&rel_path);
            let read =
                tauri::async_runtime::spawn_blocking(move || -> std::io::Result<ServedFile> {
                    let mut file = std::fs::File::open(&path)?;
                    let size = file.metadata()?.len();
                    match range.as_deref().map(|h| parse_range(h, size)) {
                        // Ranged: seek + read exactly the requested window. This
                        // is what keeps <video> seeks and huge files memory-bounded.
                        Some(Some((start, end))) => {
                            // HEAD never needs the bytes.
                            if head_only {
                                return Ok(ServedFile::Partial {
                                    body: Vec::new(),
                                    start,
                                    end,
                                    size,
                                });
                            }
                            file.seek(SeekFrom::Start(start))?;
                            let len = usize::try_from(end - start + 1)
                                .map_err(|_| std::io::Error::other("range too large"))?;
                            let mut body = vec![0u8; len];
                            file.read_exact(&mut body)?;
                            Ok(ServedFile::Partial {
                                body,
                                start,
                                end,
                                size,
                            })
                        }
                        Some(None) => Ok(ServedFile::Unsatisfiable { size }),
                        None => {
                            if head_only {
                                return Ok(ServedFile::Full {
                                    body: Vec::new(),
                                    size,
                                });
                            }
                            let mut body = Vec::new();
                            file.read_to_end(&mut body)?;
                            Ok(ServedFile::Full { body, size })
                        }
                    }
                })
                .await;
            match read {
                Ok(Ok(served)) => file_response(
                    served,
                    mime.as_deref().unwrap_or("application/octet-stream"),
                ),
                Ok(Err(_)) => status(StatusCode::NOT_FOUND),
                Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
            }
        }
        Ok(None) => status(StatusCode::NOT_FOUND),
        Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn serve_thumb(app: &tauri::AppHandle, id: &str, head_only: bool) -> Response<Vec<u8>> {
    // Snapshot the library under a short lock; never hold it across an await.
    let Ok(library) = app.state::<AppState>().current_library() else {
        // No library open (yet) — tell the WebView to back off, don't crash.
        return status(StatusCode::SERVICE_UNAVAILABLE);
    };

    let path = library.thumb_path(id);
    let read = tauri::async_runtime::spawn_blocking(move || std::fs::read(path)).await;
    match read {
        Ok(Ok(bytes)) => {
            let bytes = if head_only { Vec::new() } else { bytes };
            ok_immutable(bytes, "image/webp")
        }
        Ok(Err(_)) => status(StatusCode::NOT_FOUND),
        Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Parse a `Range` header value against a resource of `size` bytes.
///
/// Supports the single-range forms WebKit/WebView2 actually send —
/// `bytes=start-end`, `bytes=start-`, `bytes=-suffix`. Multi-range requests
/// and malformed/unsatisfiable specs return `None` (→ 416). The returned
/// bounds are inclusive and clamped to the resource size.
fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None; // multi-range unsupported
    }
    let (start_s, end_s) = spec.split_once('-')?;

    if start_s.is_empty() {
        // Suffix form: the last N bytes.
        let n: u64 = end_s.parse().ok()?;
        if n == 0 || size == 0 {
            return None;
        }
        let n = n.min(size);
        return Some((size - n, size - 1));
    }

    let start: u64 = start_s.parse().ok()?;
    if start >= size {
        return None;
    }
    let end = if end_s.is_empty() {
        size - 1
    } else {
        end_s.parse::<u64>().ok()?.min(size - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

/// Ids are nanoid over `[0-9a-z]`, length 20 today (10–32 accepted for
/// forward compatibility). This check is the complete security boundary for
/// the protocol — see module docs.
fn is_valid_id(id: &str) -> bool {
    (10..=32).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase())
}

fn file_response(served: ServedFile, mime: &str) -> Response<Vec<u8>> {
    let builder = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        // Content is content-addressed by id and never mutates in place.
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    let result = match served {
        ServedFile::Full { body, size } => builder
            .status(StatusCode::OK)
            .header(header::CONTENT_LENGTH, size)
            .body(body),
        ServedFile::Partial {
            body,
            start,
            end,
            size,
        } => builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_LENGTH, end - start + 1)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
            .body(body),
        ServedFile::Unsatisfiable { size } => builder
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{size}"))
            .body(Vec::new()),
    };
    result.unwrap_or_else(|_| fallback_500())
}

fn ok_immutable(body: Vec<u8>, mime: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        // Content is content-addressed by id and never mutates in place —
        // let the WebView cache it forever.
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_else(|_| fallback_500())
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .unwrap_or_else(|_| fallback_500())
}

fn fallback_500() -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_ids_pass() {
        assert!(is_valid_id("abc123xyz0"));
        assert!(is_valid_id("a1b2c3d4e5f6g7h8i9j0"));
    }

    #[test]
    fn invalid_ids_rejected() {
        assert!(!is_valid_id("")); // empty
        assert!(!is_valid_id("short")); // too short
        assert!(!is_valid_id("ABC123XYZ0")); // uppercase (APFS collision hazard)
        assert!(!is_valid_id("../../../etc/passwd")); // traversal attempt
        assert!(!is_valid_id("abc123xyz0abc123xyz0abc123xyz0abc")); // >32
        assert!(!is_valid_id("abc123xyz0/..")); // separator
    }

    #[test]
    fn range_normal_and_clamped() {
        assert_eq!(parse_range("bytes=0-499", 1000), Some((0, 499)));
        assert_eq!(parse_range("bytes=500-999", 1000), Some((500, 999)));
        // end beyond EOF clamps.
        assert_eq!(parse_range("bytes=500-2000", 1000), Some((500, 999)));
        // single byte (WebKit's probe request).
        assert_eq!(parse_range("bytes=0-1", 1000), Some((0, 1)));
    }

    #[test]
    fn range_open_ended_and_suffix() {
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
        // suffix longer than the file → whole file.
        assert_eq!(parse_range("bytes=-5000", 1000), Some((0, 999)));
    }

    #[test]
    fn range_invalid_forms_rejected() {
        assert_eq!(parse_range("bytes=1000-", 1000), None); // start at EOF
        assert_eq!(parse_range("bytes=900-100", 1000), None); // inverted
        assert_eq!(parse_range("bytes=-0", 1000), None); // empty suffix
        assert_eq!(parse_range("bytes=0-499,600-", 1000), None); // multi-range
        assert_eq!(parse_range("items=0-1", 1000), None); // wrong unit
        assert_eq!(parse_range("bytes=abc-def", 1000), None); // garbage
        assert_eq!(parse_range("bytes=0-", 0), None); // empty file
    }
}
