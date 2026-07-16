//! Axum router + handlers for the Collect API.
//!
//! Handlers are thin shells over existing machinery: `/api/collect/url` runs
//! `commands::url::import_url_core` (the ⌘V pipeline), `/api/collect/data`
//! runs `commands::url::write_and_process` (the temp-file → import pipeline).
//! Generic over `tauri::Runtime` so tests can drive the router with the mock
//! runtime and a tempfile library — no real window or network needed.

use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::{auth, API_VERSION};
use crate::error::AppError;
use crate::import::FileOutcome;
use crate::link;
use crate::state::AppState;

/// Transport-level body cap. Base64 inflates by ~4/3, so this comfortably
/// fits a `MAX_DATA_BYTES` payload and nothing more.
const MAX_BODY_BYTES: usize = 80 * 1024 * 1024;
/// Decoded payload cap for `/api/collect/data`.
const MAX_DATA_BYTES: usize = 50 * 1024 * 1024;

pub struct CollectCtx<R: tauri::Runtime = tauri::Wry> {
    pub app: tauri::AppHandle<R>,
    pub token: String,
    pub port: u16,
}

impl<R: tauri::Runtime> Clone for CollectCtx<R> {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            token: self.token.clone(),
            port: self.port,
        }
    }
}

pub fn build_router<R: tauri::Runtime>(ctx: CollectCtx<R>) -> Router {
    let authed = Router::new()
        .route("/api/collect/url", post(collect_url::<R>))
        .route("/api/collect/data", post(collect_data::<R>))
        .route("/api/collect/video", post(collect_video::<R>))
        .route("/api/folders", get(folders::<R>))
        .route_layer(middleware::from_fn_with_state(
            ctx.clone(),
            require_token::<R>,
        ));
    Router::new()
        .route("/api/info", get(info::<R>))
        .merge(authed)
        .route_layer(middleware::from_fn_with_state(
            ctx.clone(),
            guard_transport::<R>,
        ))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(ctx)
}

#[derive(Serialize)]
struct ErrBody {
    code: &'static str,
    message: String,
}

fn err_response(status: StatusCode, code: &'static str, message: impl Into<String>) -> Response {
    (
        status,
        Json(ErrBody {
            code,
            message: message.into(),
        }),
    )
        .into_response()
}

/// Host + Origin gate, applied to every route (see `auth` for the rationale).
async fn guard_transport<R: tauri::Runtime>(
    State(ctx): State<CollectCtx<R>>,
    req: Request,
    next: Next,
) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok());
    if !auth::host_allowed(host, ctx.port) {
        return err_response(StatusCode::FORBIDDEN, "forbidden", "unexpected Host");
    }
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    if !auth::origin_allowed(origin) {
        return err_response(
            StatusCode::FORBIDDEN,
            "forbidden",
            "origin is not a browser extension",
        );
    }
    next.run(req).await
}

/// Bearer-token gate for everything except `/api/info`.
async fn require_token<R: tauri::Runtime>(
    State(ctx): State<CollectCtx<R>>,
    req: Request,
    next: Next,
) -> Response {
    let header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    if !auth::token_matches(header, &ctx.token) {
        return err_response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "missing or invalid token",
        );
    }
    next.run(req).await
}

/// `GET /api/info` — anonymous: identity only (the extension's port probe).
/// With a valid token: app version + library state (the options page's
/// "Test connection").
async fn info<R: tauri::Runtime>(State(ctx): State<CollectCtx<R>>, req: Request) -> Response {
    let mut body = serde_json::json!({ "app": "yAssets", "apiVersion": API_VERSION });
    let header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    if auth::token_matches(header, &ctx.token) {
        let state = ctx.app.state::<AppState>();
        let library = state.library.read().ok().and_then(|slot| slot.clone());
        body["version"] = env!("CARGO_PKG_VERSION").into();
        body["libraryOpen"] = library.is_some().into();
        body["libraryName"] = library.map(|lib| lib.info().name).into();
    }
    Json(body).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectUrlBody {
    url: String,
    /// Page the asset was found on — recorded as provenance for media.
    page_url: Option<String>,
    folder_id: Option<String>,
}

/// `POST /api/collect/url` — save a link or a directly-fetchable media URL.
async fn collect_url<R: tauri::Runtime>(
    State(ctx): State<CollectCtx<R>>,
    Json(body): Json<CollectUrlBody>,
) -> Response {
    if link::normalize_pasted_url(&body.url).is_none() {
        return err_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid",
            "not a valid web URL",
        );
    }
    let state = ctx.app.state::<AppState>();
    let library = match state.current_library() {
        Ok(library) => library,
        Err(_) => return no_library(),
    };
    let client = state.http();
    match crate::commands::url::import_url_core(
        &client,
        &library,
        &body.url,
        body.folder_id,
        body.page_url,
    )
    .await
    {
        Ok(result) => {
            emit_collected(&ctx.app, &result.kind, &result.title, result.duplicate);
            (StatusCode::OK, Json(result)).into_response()
        }
        Err(err) => {
            let (status, code) = classify_import_error(&err);
            err_response(status, code, err.to_string())
        }
    }
}

/// Split an import failure into "the app couldn't fetch it" (Tier-2 byte
/// retry may succeed with the browser's cookies) versus "the fetch was fine
/// but the local import failed" (Tier-2 would hit the identical error, and for
/// a page it would degrade a bookmark into a garbage file asset). Only the
/// former gets `fetch_failed`, the code the extension retries on.
fn classify_import_error(err: &AppError) -> (StatusCode, &'static str) {
    match err {
        AppError::Network(_) | AppError::RateLimited(_) | AppError::Conflict(_) => {
            (StatusCode::BAD_GATEWAY, "fetch_failed")
        }
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "import_failed"),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectDataBody {
    filename: String,
    mime: Option<String>,
    data_base64: String,
    page_url: Option<String>,
    folder_id: Option<String>,
}

#[derive(Serialize)]
struct CollectDataResponse {
    title: String,
    duplicate: bool,
}

/// `POST /api/collect/data` — bytes captured browser-side (hotlink-protected
/// images, data: URLs, screenshots later).
async fn collect_data<R: tauri::Runtime>(
    State(ctx): State<CollectCtx<R>>,
    Json(body): Json<CollectDataBody>,
) -> Response {
    let state = ctx.app.state::<AppState>();
    let library = match state.current_library() {
        Ok(library) => library,
        Err(_) => return no_library(),
    };
    let bytes = match base64::engine::general_purpose::STANDARD.decode(body.data_base64.as_bytes())
    {
        Ok(bytes) => bytes,
        Err(_) => {
            return err_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid",
                "dataBase64 is not valid base64",
            )
        }
    };
    if bytes.is_empty() {
        return err_response(StatusCode::UNPROCESSABLE_ENTITY, "invalid", "empty payload");
    }
    if bytes.len() > MAX_DATA_BYTES {
        return err_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_large",
            "payload exceeds the 50 MB limit",
        );
    }

    let (stem, ext) = split_filename(&body.filename, body.mime.as_deref());
    let title = stem.clone();
    let library = Arc::clone(&library);
    let page_url = body.page_url.clone();
    let folder_id = body.folder_id.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::url::write_and_process(
            &library,
            &bytes,
            &ext,
            folder_id.as_deref(),
            page_url.as_deref(),
            None,
            "file",
            Some(&stem),
            false,
        )
    })
    .await;

    match outcome {
        Ok(Ok(outcome)) => {
            let duplicate = matches!(outcome, FileOutcome::Duplicate { .. });
            emit_collected(&ctx.app, "media", &title, duplicate);
            (
                StatusCode::OK,
                Json(CollectDataResponse { title, duplicate }),
            )
                .into_response()
        }
        Ok(Err(err)) => err_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "import_failed",
            err.to_string(),
        ),
        Err(err) => {
            log::error!("collect data worker failed: {err}");
            err_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "import_failed",
                "import worker failed",
            )
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectVideoBody {
    /// The page hosting the video (a tweet URL, not a CDN stream) — this is
    /// what yt-dlp resolves.
    url: String,
    page_url: Option<String>,
    folder_id: Option<String>,
}

/// `POST /api/collect/video` — streamed platform video via the managed
/// yt-dlp binary. Slow (network download): the client is expected to wait.
async fn collect_video<R: tauri::Runtime>(
    State(ctx): State<CollectCtx<R>>,
    Json(body): Json<CollectVideoBody>,
) -> Response {
    // yt-dlp fetches this URL itself — same egress posture as our own
    // fetches: https-only, public hosts only.
    let parsed = match link::normalize_pasted_url(&body.url) {
        Some(parsed) => parsed,
        None => {
            return err_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid",
                "not a valid web URL",
            )
        }
    };
    if parsed.scheme() != "https" || crate::commands::sources::host_is_blocked(parsed.host_str()) {
        return err_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid",
            "refusing non-https or private-host URL",
        );
    }

    let state = ctx.app.state::<AppState>();
    let library = match state.current_library() {
        Ok(library) => library,
        Err(_) => return no_library(),
    };
    let tools = match crate::ytdlp::tools_dir(&ctx.app) {
        Ok(tools) => tools,
        Err(err) => {
            return err_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                err.to_string(),
            )
        }
    };
    if crate::ytdlp::installed_version(&tools).await.is_none() {
        return err_response(
            StatusCode::CONFLICT,
            "tool_missing",
            "the video downloader isn't installed — enable it in yAssets Preferences ▸ Collect",
        );
    }

    // Drop-guarded: cleanup must also run when the handler future is
    // cancelled mid-download (client disconnect, browser closed) — straight
    // line code after the awaits would never execute on that path.
    let dest = TempDirGuard(
        std::env::temp_dir().join(format!("yassets-video-{}", crate::library::new_id())),
    );
    // Download the URL that passed the guard, NOT the raw body string —
    // normalize_pasted_url upgrades http→https, and the executed URL must be
    // the checked one.
    let checked_url = parsed.to_string();
    let downloaded = crate::ytdlp::download_video(&tools, &checked_url, &dest.0).await;
    match downloaded {
        Ok(path) => {
            let title = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_else(|| "video".to_string());
            let source = body.page_url.clone().unwrap_or(checked_url);
            let library = Arc::clone(&library);
            let folder_id = body.folder_id.clone();
            let outcome = tauri::async_runtime::spawn_blocking(move || {
                let seen = std::sync::Mutex::new(std::collections::HashSet::<String>::new());
                crate::import::process_file_with_meta(
                    &library,
                    &path,
                    folder_id.as_deref(),
                    &seen,
                    false,
                    Some(&source),
                    None,
                    "file",
                    None,
                )
            })
            .await;
            match outcome {
                Ok(Ok(outcome)) => {
                    let duplicate = matches!(outcome, FileOutcome::Duplicate { .. });
                    emit_collected(&ctx.app, "media", &title, duplicate);
                    (
                        StatusCode::OK,
                        Json(CollectDataResponse { title, duplicate }),
                    )
                        .into_response()
                }
                Ok(Err(err)) => {
                    err_response(StatusCode::INTERNAL_SERVER_ERROR, "import_failed", err)
                }
                Err(err) => {
                    log::error!("video import worker failed: {err}");
                    err_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "import_failed",
                        "import worker failed",
                    )
                }
            }
        }
        Err(AppError::NotFound(_)) => err_response(
            StatusCode::CONFLICT,
            "tool_missing",
            "the video downloader isn't installed — enable it in yAssets Preferences ▸ Collect",
        ),
        Err(err) => err_response(StatusCode::BAD_GATEWAY, "video_failed", err.to_string()),
    }
}

/// Best-effort temp-dir removal on scope exit — including future cancellation.
struct TempDirGuard(std::path::PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderItem {
    id: String,
    parent_id: Option<String>,
    name: String,
}

/// `GET /api/folders` — flat list for the extension's folder picker (V2 UI).
async fn folders<R: tauri::Runtime>(State(ctx): State<CollectCtx<R>>) -> Response {
    let state = ctx.app.state::<AppState>();
    let library = match state.current_library() {
        Ok(library) => library,
        Err(_) => return no_library(),
    };
    let rows = library
        .read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, parent_id, name FROM folders
                 ORDER BY position, name COLLATE NOCASE",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(FolderItem {
                        id: row.get(0)?,
                        parent_id: row.get(1)?,
                        name: row.get(2)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await;
    match rows {
        Ok(rows) => (StatusCode::OK, Json(rows)).into_response(),
        Err(err) => err_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            err.to_string(),
        ),
    }
}

fn no_library() -> Response {
    err_response(
        StatusCode::CONFLICT,
        "no_library",
        "open a library in yAssets first",
    )
}

fn emit_collected<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    kind: &str,
    title: &str,
    duplicate: bool,
) {
    use tauri_specta::Event;
    let _ = crate::events::CollectImported {
        kind: kind.to_string(),
        title: title.to_string(),
        duplicate,
    }
    .emit(app);
}

/// Split an untrusted client filename into (display stem, sanitized ext).
/// Path components and hidden-file dots are stripped; a missing/garbage
/// extension falls back to the mime type, then `bin`. The import pipeline
/// only ever sees the sanitized ext in a temp path the app itself builds.
fn split_filename(filename: &str, mime: Option<&str>) -> (String, String) {
    let name = filename
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('.');
    let (mut stem, mut ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && ext_is_clean(ext) => {
            (stem.to_string(), ext.to_ascii_lowercase())
        }
        _ => (name.to_string(), String::new()),
    };
    if ext.is_empty() {
        ext = link::media_ext_for_content_type(mime.unwrap_or(""))
            .unwrap_or("bin")
            .to_string();
    }
    stem = stem.trim().to_string();
    if stem.is_empty() {
        stem = "capture".to_string();
    }
    if stem.chars().count() > 120 {
        stem = stem.chars().take(120).collect();
    }
    (stem, ext)
}

fn ext_is_clean(ext: &str) -> bool {
    !ext.is_empty() && ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Library;
    use axum::body::Body;
    use tower::ServiceExt;

    fn split(f: &str, m: Option<&str>) -> (String, String) {
        split_filename(f, m)
    }

    #[test]
    fn import_errors_split_fetch_from_local() {
        // Fetch/parse/SSRF-refusal class → Tier-2-retryable.
        assert_eq!(
            classify_import_error(&AppError::Network("offline".into())),
            (StatusCode::BAD_GATEWAY, "fetch_failed")
        );
        assert_eq!(
            classify_import_error(&AppError::RateLimited("429".into())),
            (StatusCode::BAD_GATEWAY, "fetch_failed")
        );
        assert_eq!(
            classify_import_error(&AppError::Conflict("remote file too large".into())),
            (StatusCode::BAD_GATEWAY, "fetch_failed")
        );
        // Local post-fetch failures → NOT retryable (Tier-2 would recur, and a
        // page would be degraded into a file asset).
        assert_eq!(
            classify_import_error(&AppError::Io("disk full".into())),
            (StatusCode::INTERNAL_SERVER_ERROR, "import_failed")
        );
        assert_eq!(
            classify_import_error(&AppError::Db("locked".into())),
            (StatusCode::INTERNAL_SERVER_ERROR, "import_failed")
        );
        assert_eq!(
            classify_import_error(&AppError::Internal),
            (StatusCode::INTERNAL_SERVER_ERROR, "import_failed")
        );
    }

    #[test]
    fn split_filename_sanitizes() {
        assert_eq!(split("photo.JPG", None), ("photo".into(), "jpg".into()));
        assert_eq!(
            split("../../etc/passwd", Some("image/png")),
            ("passwd".into(), "png".into())
        );
        assert_eq!(
            split(".hidden", Some("image/webp")),
            ("hidden".into(), "webp".into())
        );
        assert_eq!(split("", None), ("capture".into(), "bin".into()));
        // A dot-suffix that isn't a clean extension stays in the stem.
        assert_eq!(
            split("v1.2-final", None),
            ("v1.2-final".into(), "bin".into())
        );
    }

    // ---- Router-level tests over the mock runtime ----

    struct Harness {
        _app: tauri::App<tauri::test::MockRuntime>,
        router: Router,
        _tmp: Option<tempfile::TempDir>,
    }

    fn harness(with_library: bool) -> Harness {
        let app = tauri::test::mock_app();
        app.manage(AppState::default());
        // Handlers emit CollectImported via tauri-specta, which panics unless
        // the event registry is mounted (lib.rs does this for the real app).
        tauri_specta::Builder::<tauri::test::MockRuntime>::new()
            .events(tauri_specta::collect_events![
                crate::events::CollectImported
            ])
            .mount_events(&app);
        let mut tmp = None;
        if with_library {
            let dir = tempfile::tempdir().expect("tempdir");
            let lib = Library::create(&dir.path().join("Lib")).expect("create library");
            let state = app.state::<AppState>();
            *state.library.write().expect("library slot") = Some(std::sync::Arc::new(lib));
            tmp = Some(dir);
        }
        let ctx = CollectCtx {
            app: app.handle().clone(),
            token: "secret-token".into(),
            port: 41420,
        };
        Harness {
            router: build_router(ctx),
            _app: app,
            _tmp: tmp,
        }
    }

    fn request(method: &str, path: &str, token: Option<&str>, body: Option<String>) -> Request {
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, "127.0.0.1:41420")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        builder
            .body(body.map(Body::from).unwrap_or_else(Body::empty))
            .expect("request")
    }

    async fn body_json(resp: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), 1 << 20)
            .await
            .expect("body");
        serde_json::from_slice(&bytes).expect("json body")
    }

    fn png_base64() -> String {
        let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([200, 30, 30, 255]));
        let mut buf = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .expect("encode png");
        base64::engine::general_purpose::STANDARD.encode(buf.into_inner())
    }

    /// Real-socket smoke: bind an ephemeral loopback port, serve the router
    /// built for THAT port, and round-trip genuine HTTP requests — exercising
    /// the TCP path oneshot() skips (bind + axum::serve, real Host header).
    #[tokio::test]
    async fn serves_over_a_real_loopback_socket() {
        let app = tauri::test::mock_app();
        app.manage(AppState::default());
        tauri_specta::Builder::<tauri::test::MockRuntime>::new()
            .events(tauri_specta::collect_events![
                crate::events::CollectImported
            ])
            .mount_events(&app);

        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let router = build_router(CollectCtx {
            app: app.handle().clone(),
            token: "secret-token".into(),
            port,
        });
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        // A plain client (the shared AppState client is https-only).
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("http://127.0.0.1:{port}/api/info"))
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status(), reqwest::StatusCode::OK);
        let body: serde_json::Value = resp.json().await.expect("json");
        assert_eq!(body["app"], "yAssets");
        assert_eq!(body["apiVersion"], 1);

        // The token gate rejects an anonymous authed route over the real socket.
        let resp = client
            .post(format!("http://127.0.0.1:{port}/api/collect/url"))
            .json(&serde_json::json!({ "url": "https://example.com" }))
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);

        server.abort();
    }

    #[tokio::test]
    async fn info_is_anonymous_but_details_need_the_token() {
        let h = harness(false);
        let resp = h
            .router
            .clone()
            .oneshot(request("GET", "/api/info", None, None))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = body_json(resp).await;
        assert_eq!(body["app"], "yAssets");
        assert_eq!(body["apiVersion"], 1);
        assert!(body.get("version").is_none());

        let resp = h
            .router
            .clone()
            .oneshot(request("GET", "/api/info", Some("secret-token"), None))
            .await
            .expect("response");
        let body = body_json(resp).await;
        assert_eq!(body["libraryOpen"], false);
        assert!(body["version"].is_string());
    }

    #[tokio::test]
    async fn wrong_token_is_401_and_bad_origin_is_403() {
        let h = harness(false);
        let resp = h
            .router
            .clone()
            .oneshot(request("GET", "/api/folders", Some("wrong"), None))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(body_json(resp).await["code"], "unauthorized");

        let mut req = request("GET", "/api/folders", Some("secret-token"), None);
        req.headers_mut()
            .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
        let resp = h.router.clone().oneshot(req).await.expect("response");
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);

        let mut req = request("GET", "/api/folders", Some("secret-token"), None);
        req.headers_mut()
            .insert(header::HOST, "evil.example:41420".parse().unwrap());
        let resp = h.router.clone().oneshot(req).await.expect("response");
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn extension_origin_is_allowed() {
        let h = harness(false);
        let mut req = request("GET", "/api/info", None, None);
        req.headers_mut().insert(
            header::ORIGIN,
            "chrome-extension://abcdefghijk".parse().unwrap(),
        );
        let resp = h.router.clone().oneshot(req).await.expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn collect_data_requires_a_library() {
        let h = harness(false);
        let body = serde_json::json!({
            "filename": "a.png", "dataBase64": png_base64()
        });
        let resp = h
            .router
            .clone()
            .oneshot(request(
                "POST",
                "/api/collect/data",
                Some("secret-token"),
                Some(body.to_string()),
            ))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        assert_eq!(body_json(resp).await["code"], "no_library");
    }

    #[tokio::test]
    async fn collect_data_imports_then_dedupes() {
        let h = harness(true);
        let payload = serde_json::json!({
            "filename": "shot.png",
            "mime": "image/png",
            "dataBase64": png_base64(),
            "pageUrl": "https://example.com/post/1"
        })
        .to_string();

        let resp = h
            .router
            .clone()
            .oneshot(request(
                "POST",
                "/api/collect/data",
                Some("secret-token"),
                Some(payload.clone()),
            ))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = body_json(resp).await;
        assert_eq!(body["title"], "shot");
        assert_eq!(body["duplicate"], false);

        // Same bytes again — blake3 dedupe reports duplicate, no new asset.
        let resp = h
            .router
            .clone()
            .oneshot(request(
                "POST",
                "/api/collect/data",
                Some("secret-token"),
                Some(payload),
            ))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body_json(resp).await["duplicate"], true);
    }

    #[tokio::test]
    async fn collect_data_rejects_garbage_base64() {
        let h = harness(true);
        let body = serde_json::json!({ "filename": "a.png", "dataBase64": "!!!not-base64!!!" });
        let resp = h
            .router
            .clone()
            .oneshot(request(
                "POST",
                "/api/collect/data",
                Some("secret-token"),
                Some(body.to_string()),
            ))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn collect_url_rejects_non_urls() {
        let h = harness(true);
        let body = serde_json::json!({ "url": "not a url" });
        let resp = h
            .router
            .clone()
            .oneshot(request(
                "POST",
                "/api/collect/url",
                Some("secret-token"),
                Some(body.to_string()),
            ))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body_json(resp).await["code"], "invalid");
    }

    #[tokio::test]
    async fn collect_video_rejects_bad_urls_and_missing_tool() {
        let h = harness(true);
        // Private-host URLs are refused before anything else runs. (Plain
        // http is upgraded to https by normalize_pasted_url, like ⌘V.)
        let resp = h
            .router
            .clone()
            .oneshot(request(
                "POST",
                "/api/collect/video",
                Some("secret-token"),
                Some(serde_json::json!({ "url": "https://192.168.1.1/v" }).to_string()),
            ))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

        // Valid https URL but no yt-dlp installed (mock app data dir is empty).
        let resp = h
            .router
            .clone()
            .oneshot(request(
                "POST",
                "/api/collect/video",
                Some("secret-token"),
                Some(serde_json::json!({ "url": "https://x.com/user/status/1" }).to_string()),
            ))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        assert_eq!(body_json(resp).await["code"], "tool_missing");
    }

    #[tokio::test]
    async fn folders_lists_from_the_open_library() {
        let h = harness(true);
        let resp = h
            .router
            .clone()
            .oneshot(request("GET", "/api/folders", Some("secret-token"), None))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(body_json(resp).await.as_array().is_some());
    }
}
