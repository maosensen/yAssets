//! Custom async `yasset://` protocol serving library media to the WebView.
//!
//! Routes (path is percent-decoded before routing; `convertFileSrc` on the
//! frontend encodes it and handles the platform URL shape — macOS/Linux
//! `yasset://localhost/<route>/<id>`, Windows `http://yasset.localhost/...`):
//!
//! - `thumb/<id>` → `<library>/thumbs/<shard>/<id>.webp` — hot path, zero DB,
//!   the location is derived purely from the id.
//! - `file/<id>`  → original file (needs a DB lookup for `rel_path`/mime;
//!   lands in M3 together with the assets command surface).
//!
//! Security model: this handler is the only bridge from the WebView to library
//! files. The id whitelist (`^[0-9a-z]{10,32}$`) is the complete input surface —
//! no user-controlled path segments ever reach a filesystem join, so path
//! traversal is structurally impossible. The frontend never sees absolute paths.
//!
//! CSP: `img-src` in tauri.conf.json must list `yasset:` and
//! `http://yasset.localhost` for the two platform URL shapes.

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};
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

    match route {
        "thumb" => serve_thumb(app, id).await,
        "file" => serve_file(app, id).await,
        _ => status(StatusCode::NOT_FOUND),
    }
}

/// Original file: one reader-pool lookup for `rel_path` + mime, then a
/// blocking read. Managed files never mutate in place, so immutable caching
/// applies here too.
async fn serve_file(app: &tauri::AppHandle, id: &str) -> Response<Vec<u8>> {
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
            let read = tauri::async_runtime::spawn_blocking(move || std::fs::read(path)).await;
            match read {
                Ok(Ok(bytes)) => {
                    ok_immutable(bytes, mime.as_deref().unwrap_or("application/octet-stream"))
                }
                Ok(Err(_)) => status(StatusCode::NOT_FOUND),
                Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
            }
        }
        Ok(None) => status(StatusCode::NOT_FOUND),
        Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn serve_thumb(app: &tauri::AppHandle, id: &str) -> Response<Vec<u8>> {
    // Snapshot the library under a short lock; never hold it across an await.
    let Ok(library) = app.state::<AppState>().current_library() else {
        // No library open (yet) — tell the WebView to back off, don't crash.
        return status(StatusCode::SERVICE_UNAVAILABLE);
    };

    let path = library.thumb_path(id);
    let read = tauri::async_runtime::spawn_blocking(move || std::fs::read(path)).await;
    match read {
        Ok(Ok(bytes)) => ok_immutable(bytes, "image/webp"),
        Ok(Err(_)) => status(StatusCode::NOT_FOUND),
        Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
    }
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
}
