//! Axum shell for the agent surface: `/api/agent/*` (REST) and `/mcp`
//! (JSON-RPC). Every handler is a thin wrapper over `super::api` — the same
//! functions the MCP tools call.
//!
//! Two gates, in order: the shared transport guard from `collect::server`
//! (loopback Host + no browser Origin, applied by the parent router) and this
//! module's `require_agent`, which checks the enable flag *and* the agent token.
//! Checking the flag per request matters because the listener may be up purely
//! for the Collect API.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;

use super::api;
use super::dto::SearchRequest;
use super::AgentCtx;
use crate::collect::auth;
use crate::collect::server::err_response;
use crate::error::AppError;

/// Matches the UI's Find Similar default — tight enough to mean "the same
/// picture", loose enough to survive a re-encode.
const DEFAULT_SIMILAR_DISTANCE: u32 = 10;

pub fn router<R: tauri::Runtime>(ctx: AgentCtx<R>) -> Router {
    Router::new()
        .route("/api/agent/info", get(info::<R>))
        .route("/api/agent/search", post(search::<R>))
        .route("/api/agent/assets/{id}", get(detail::<R>))
        .route("/api/agent/assets/{id}/similar", get(similar::<R>))
        .route("/api/agent/assets/{id}/thumb", get(thumb::<R>))
        .route("/api/agent/assets/{id}/file", get(file::<R>))
        .route("/api/agent/folders", get(folders::<R>))
        .route("/api/agent/folders/{id}/stats", get(folder_stats::<R>))
        .route("/api/agent/tags", get(tags::<R>))
        .route("/api/agent/smart-folders", get(smart_folders::<R>))
        .route("/api/agent/stats", get(stats::<R>))
        .route("/api/agent/duplicates", get(duplicates::<R>))
        // MCP Streamable HTTP. GET would be the server→client SSE stream; we
        // never push, so it is honestly declined rather than left hanging.
        .route("/mcp", post(mcp_rpc::<R>).get(mcp_no_stream))
        .route_layer(middleware::from_fn_with_state(
            ctx.clone(),
            require_agent::<R>,
        ))
        .with_state(ctx)
}

/// Enable-flag + bearer-token gate for every agent route.
async fn require_agent<R: tauri::Runtime>(
    State(ctx): State<AgentCtx<R>>,
    req: axum::extract::Request,
    next: Next,
) -> Response {
    if !ctx.enabled {
        return err_response(
            StatusCode::FORBIDDEN,
            "agent_disabled",
            "turn on Preferences → Agent in yAssets first",
        );
    }
    let header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    if !auth::token_matches(header, &ctx.token) {
        return err_response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "missing or invalid agent token",
        );
    }
    next.run(req).await
}

/// `AppError` → HTTP. Conflict covers both "you asked for something impossible"
/// and validation, which is a 422 from a client's point of view.
pub(crate) fn status_for(err: &AppError) -> (StatusCode, &'static str) {
    match err {
        AppError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
        AppError::NoLibraryOpen => (StatusCode::CONFLICT, "no_library"),
        AppError::Conflict(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid"),
        AppError::RateLimited(_) => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
        AppError::Network(_) => (StatusCode::BAD_GATEWAY, "fetch_failed"),
        AppError::LibraryIncompatible(_) => (StatusCode::CONFLICT, "library_incompatible"),
        AppError::Db(_) | AppError::Io(_) | AppError::Internal => {
            (StatusCode::INTERNAL_SERVER_ERROR, "internal")
        }
    }
}

fn fail(err: AppError) -> Response {
    let (status, code) = status_for(&err);
    err_response(status, code, err.to_string())
}

fn ok_json<T: Serialize>(value: Result<T, AppError>) -> Response {
    match value {
        Ok(value) => (StatusCode::OK, Json(value)).into_response(),
        Err(err) => fail(err),
    }
}

// ------------------------------------------------------------------ handlers ---

async fn info<R: tauri::Runtime>(State(ctx): State<AgentCtx<R>>) -> Response {
    (StatusCode::OK, Json(api::info(&ctx.app))).into_response()
}

async fn search<R: tauri::Runtime>(State(ctx): State<AgentCtx<R>>, body: Bytes) -> Response {
    // An empty body is the common "just give me the newest" case, so treat it
    // as `{}` rather than a parse error.
    let request: SearchRequest = if body.is_empty() {
        SearchRequest::default()
    } else {
        match serde_json::from_slice(&body) {
            Ok(request) => request,
            Err(err) => {
                return err_response(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid",
                    format!("could not parse the search body: {err}"),
                )
            }
        }
    };
    ok_json(api::search(&ctx.app, request).await)
}

async fn detail<R: tauri::Runtime>(
    State(ctx): State<AgentCtx<R>>,
    Path(id): Path<String>,
) -> Response {
    ok_json(api::detail(&ctx.app, &id).await)
}

/// One numeric query parameter, read straight off the URI. Hand-parsed so the
/// router needs no extra axum feature for a single optional integer; anything
/// unparseable falls back to the default rather than failing the request.
fn query_u32(uri: &Uri, key: &str) -> Option<u32> {
    uri.query()?.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name == key).then(|| value.parse().ok())?
    })
}

async fn similar<R: tauri::Runtime>(
    State(ctx): State<AgentCtx<R>>,
    Path(id): Path<String>,
    uri: Uri,
) -> Response {
    let max_distance = query_u32(&uri, "maxDistance").unwrap_or(DEFAULT_SIMILAR_DISTANCE);
    ok_json(api::similar(&ctx.app, &id, max_distance).await)
}

async fn folders<R: tauri::Runtime>(State(ctx): State<AgentCtx<R>>) -> Response {
    ok_json(api::folders(&ctx.app).await)
}

async fn folder_stats<R: tauri::Runtime>(
    State(ctx): State<AgentCtx<R>>,
    Path(id): Path<String>,
) -> Response {
    ok_json(api::folder_stats(&ctx.app, &id).await)
}

async fn tags<R: tauri::Runtime>(State(ctx): State<AgentCtx<R>>) -> Response {
    ok_json(api::tags(&ctx.app).await)
}

async fn smart_folders<R: tauri::Runtime>(State(ctx): State<AgentCtx<R>>) -> Response {
    ok_json(api::smart_folders(&ctx.app).await)
}

async fn stats<R: tauri::Runtime>(State(ctx): State<AgentCtx<R>>) -> Response {
    ok_json(api::stats(&ctx.app).await)
}

/// Throttled inside `api::duplicates` (shared with the MCP tool) — a second
/// sweep inside the window comes back as 429 rather than queueing.
async fn duplicates<R: tauri::Runtime>(State(ctx): State<AgentCtx<R>>) -> Response {
    ok_json(api::duplicates(&ctx.app).await)
}

fn bytes_response(bytes: Vec<u8>, mime: &str) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime.to_string()),
            // Content is immutable per id, but an agent shouldn't be told to
            // cache forever by a loopback API — keep it simple and explicit.
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        bytes,
    )
        .into_response()
}

async fn thumb<R: tauri::Runtime>(
    State(ctx): State<AgentCtx<R>>,
    Path(id): Path<String>,
) -> Response {
    match api::thumb_bytes(&ctx.app, &id).await {
        Ok(bytes) => bytes_response(bytes, "image/webp"),
        Err(err) => fail(err),
    }
}

async fn file<R: tauri::Runtime>(
    State(ctx): State<AgentCtx<R>>,
    Path(id): Path<String>,
) -> Response {
    match api::file_bytes(&ctx.app, &id).await {
        Ok((bytes, mime)) => bytes_response(bytes, &mime),
        Err(err) => fail(err),
    }
}

// ----------------------------------------------------------------------- MCP ---

async fn mcp_rpc<R: tauri::Runtime>(State(ctx): State<AgentCtx<R>>, body: Bytes) -> Response {
    super::mcp::handle(&ctx.app, &body).await
}

async fn mcp_no_stream() -> Response {
    err_response(
        StatusCode::METHOD_NOT_ALLOWED,
        "no_sse_stream",
        "this server answers MCP over POST only — it never pushes notifications",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collect::server::testing::{
        body_bytes, body_json, build, request, Harness, AGENT_TOKEN, COLLECT_TOKEN,
    };
    use tower::ServiceExt;

    /// A tempdir path an assertion can look for: if it ever shows up in a
    /// response body, the redaction leaked.
    const SECRET_DIR: &str = "/Users/nobody/Private Pictures";

    fn seeded() -> Harness {
        let h = build(true, false, true);
        let lib = h.library.clone().expect("library");
        lib.with_writer(|conn| {
            conn.execute_batch(&format!(
                "INSERT INTO tags (id, name, color, created_at)
                 VALUES ('tag00000000000000001', 'screenshot', '#3b82f6', 1000);
                 INSERT INTO folders (id, name, position, created_at, updated_at)
                 VALUES ('folder0000000000000a', 'Refs', 0, 1000, 1000);
                 INSERT INTO assets (id, name, ext, mime, size, hash_blake3, rel_path,
                                     src_path, rating, has_thumb, imported_at, updated_at)
                 VALUES
                 ('asset000000000000001', 'Alpha', 'png', 'image/png', 10, 'h1',
                  'assets/as/asset000000000000001.png', '{SECRET_DIR}/Alpha.png', 3, 1, 1000, 1000),
                 ('asset000000000000002', 'beta', 'jpg', 'image/jpeg', 20, 'h2',
                  'assets/as/asset000000000000002.jpg', NULL, 0, 0, 2000, 2000),
                 ('asset000000000000003', 'huge', 'psd', NULL, 999999999, 'h3',
                  'assets/as/asset000000000000003.psd', NULL, 0, 0, 3000, 3000);
                 INSERT INTO asset_tags (asset_id, tag_id)
                 VALUES ('asset000000000000001', 'tag00000000000000001');
                 INSERT INTO asset_folders (asset_id, folder_id, added_at)
                 VALUES ('asset000000000000001', 'folder0000000000000a', 0);"
            ))?;
            Ok(())
        })
        .expect("seed");
        h
    }

    async fn get(h: &Harness, path: &str) -> Response {
        h.router
            .clone()
            .oneshot(request("GET", path, Some(AGENT_TOKEN), None))
            .await
            .expect("response")
    }

    async fn post(h: &Harness, path: &str, body: serde_json::Value) -> Response {
        h.router
            .clone()
            .oneshot(request(
                "POST",
                path,
                Some(AGENT_TOKEN),
                Some(body.to_string()),
            ))
            .await
            .expect("response")
    }

    #[tokio::test]
    async fn the_collect_token_cannot_open_the_agent_surface() {
        let h = seeded();
        for token in [None, Some("wrong"), Some(COLLECT_TOKEN)] {
            let resp = h
                .router
                .clone()
                .oneshot(request("GET", "/api/agent/info", token, None))
                .await
                .expect("response");
            assert_eq!(
                resp.status(),
                StatusCode::UNAUTHORIZED,
                "token {token:?} must not authenticate"
            );
            assert_eq!(body_json(resp).await["code"], "unauthorized");
        }
        assert_eq!(get(&h, "/api/agent/info").await.status(), StatusCode::OK);
    }

    /// …and the reverse: the agent token is no good on the Collect routes.
    #[tokio::test]
    async fn the_agent_token_cannot_open_the_collect_surface() {
        let h = build(true, true, true);
        let resp = h
            .router
            .clone()
            .oneshot(request("GET", "/api/folders", Some(AGENT_TOKEN), None))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_disabled_surface_says_so_instead_of_404() {
        let h = build(true, true, false);
        let resp = get(&h, "/api/agent/stats").await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        assert_eq!(body_json(resp).await["code"], "agent_disabled");
    }

    #[tokio::test]
    async fn the_shared_transport_guard_still_applies() {
        let h = seeded();
        let mut req = request("GET", "/api/agent/stats", Some(AGENT_TOKEN), None);
        req.headers_mut()
            .insert(header::HOST, "evil.example:41420".parse().unwrap());
        let resp = h.router.clone().oneshot(req).await.expect("response");
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);

        // A web page's fetch carries an Origin; that is exactly what must fail.
        let mut req = request("POST", "/mcp", Some(AGENT_TOKEN), Some("{}".into()));
        req.headers_mut()
            .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
        let resp = h.router.clone().oneshot(req).await.expect("response");
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn no_response_ever_carries_an_absolute_path() {
        let h = seeded();
        for path in [
            "/api/agent/info",
            "/api/agent/assets/asset000000000000001",
            "/api/agent/folders",
            "/api/agent/tags",
            "/api/agent/stats",
        ] {
            let body = String::from_utf8(body_bytes(get(&h, path).await).await).expect("utf8");
            assert!(
                !body.contains(SECRET_DIR) && !body.contains("/Lib"),
                "{path} leaked a host path: {body}"
            );
        }
        // The provenance filename survives; its directory does not.
        let detail = body_json(get(&h, "/api/agent/assets/asset000000000000001").await).await;
        assert_eq!(detail["srcFilename"], "Alpha.png");
        assert!(detail.get("srcPath").is_none());
    }

    #[tokio::test]
    async fn info_reports_capabilities_and_read_only() {
        let h = seeded();
        let body = body_json(get(&h, "/api/agent/info").await).await;
        assert_eq!(body["app"], "yAssets");
        assert_eq!(body["libraryOpen"], true);
        assert_eq!(body["readOnly"], true);
        assert_eq!(body["limits"]["maxSearchLimit"], 200);
        assert!(body["capabilities"]
            .as_array()
            .expect("capabilities")
            .iter()
            .any(|c| c == "mcp"));
    }

    #[tokio::test]
    async fn search_defaults_pages_and_clamps() {
        let h = seeded();
        let body = body_json(post(&h, "/api/agent/search", serde_json::json!({})).await).await;
        assert_eq!(body["total"], 3);
        assert_eq!(body["limit"], 50);
        assert!(body["nextOffset"].is_null());
        // Newest first by default.
        assert_eq!(body["items"][0]["name"], "huge");

        let page = body_json(
            post(
                &h,
                "/api/agent/search",
                serde_json::json!({ "limit": 100000, "sort": "name", "dir": "asc" }),
            )
            .await,
        )
        .await;
        assert_eq!(page["limit"], 200, "limit must be clamped, not trusted");
        assert_eq!(page["items"][0]["name"], "Alpha");

        let first =
            body_json(post(&h, "/api/agent/search", serde_json::json!({ "limit": 1 })).await).await;
        assert_eq!(first["nextOffset"], 1);
    }

    #[tokio::test]
    async fn search_filters_and_optional_joins_work() {
        let h = seeded();
        let untagged = body_json(
            post(
                &h,
                "/api/agent/search",
                serde_json::json!({ "scope": "untagged" }),
            )
            .await,
        )
        .await;
        assert_eq!(untagged["total"], 2);

        let in_folder = body_json(
            post(
                &h,
                "/api/agent/search",
                serde_json::json!({
                    "scope": { "folder": "folder0000000000000a" },
                    "include": ["tags", "folders"],
                }),
            )
            .await,
        )
        .await;
        assert_eq!(in_folder["total"], 1);
        assert_eq!(in_folder["items"][0]["tags"][0]["name"], "screenshot");
        assert_eq!(
            in_folder["items"][0]["folderIds"][0],
            "folder0000000000000a"
        );

        // Without `include`, the joins are absent rather than null-filled.
        let plain = body_json(
            post(
                &h,
                "/api/agent/search",
                serde_json::json!({ "ratingMin": 3 }),
            )
            .await,
        )
        .await;
        assert_eq!(plain["total"], 1);
        assert!(plain["items"][0].get("tags").is_none());
    }

    #[tokio::test]
    async fn a_bad_search_body_explains_itself() {
        let h = seeded();
        let resp = post(
            &h,
            "/api/agent/search",
            serde_json::json!({ "scope": "favourites" }),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = body_json(resp).await;
        assert_eq!(body["code"], "invalid");
        assert!(
            body["message"]
                .as_str()
                .expect("message")
                .contains("untagged"),
            "the error should name the accepted scopes: {body}"
        );

        let resp = h
            .router
            .clone()
            .oneshot(request(
                "POST",
                "/api/agent/search",
                Some(AGENT_TOKEN),
                Some("{ not json".into()),
            ))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn unknown_and_malformed_ids_are_404() {
        let h = seeded();
        assert_eq!(
            get(&h, "/api/agent/assets/asset000000000000999")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        // Never reaches the filesystem: the id shape is rejected first.
        assert_eq!(
            get(&h, "/api/agent/assets/..%2F..%2Fetc%2Fpasswd/thumb")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get(&h, "/api/agent/folders/nope/stats").await.status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn thumbnails_come_back_as_webp_bytes() {
        let h = seeded();
        let lib = h.library.clone().expect("library");
        let path = lib.thumb_path("asset000000000000001");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(&path, b"RIFF-fake-webp").expect("write thumb");

        let resp = get(&h, "/api/agent/assets/asset000000000000001/thumb").await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("image/webp")
        );
        assert_eq!(body_bytes(resp).await, b"RIFF-fake-webp");

        // An asset without a cached thumbnail is a 404, not a 500.
        assert_eq!(
            get(&h, "/api/agent/assets/asset000000000000002/thumb")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn an_oversized_original_is_refused_with_advice() {
        let h = seeded();
        let resp = get(&h, "/api/agent/assets/asset000000000000003/file").await;
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = body_json(resp).await;
        assert!(
            body["message"]
                .as_str()
                .expect("message")
                .contains("thumbnail"),
            "tell the caller what to do instead: {body}"
        );
    }

    // ---- MCP ----

    async fn rpc(h: &Harness, payload: serde_json::Value) -> serde_json::Value {
        let resp = post(h, "/mcp", payload).await;
        assert_eq!(resp.status(), StatusCode::OK);
        body_json(resp).await
    }

    #[tokio::test]
    async fn initialize_advertises_tools() {
        let h = seeded();
        let body = rpc(
            &h,
            serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
        )
        .await;
        assert_eq!(body["id"], 1);
        assert!(body["result"]["protocolVersion"].is_string());
        assert!(body["result"]["capabilities"]["tools"].is_object());
        assert_eq!(body["result"]["serverInfo"]["name"], "yassets");
    }

    #[tokio::test]
    async fn a_notification_is_acknowledged_with_no_body() {
        let h = seeded();
        let resp = post(
            &h,
            "/mcp",
            serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        assert!(body_bytes(resp).await.is_empty());
    }

    #[tokio::test]
    async fn tools_list_matches_the_declared_surface() {
        let h = seeded();
        let body = rpc(
            &h,
            serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        )
        .await;
        let names: Vec<&str> = body["result"]["tools"]
            .as_array()
            .expect("tools")
            .iter()
            .map(|tool| tool["name"].as_str().expect("name"))
            .collect();
        assert!(names.contains(&"search_assets"));
        assert!(names.contains(&"view_asset"));
        assert!(!names.contains(&"empty_trash"));
    }

    #[tokio::test]
    async fn calling_search_through_mcp_returns_the_same_data() {
        let h = seeded();
        let body = rpc(
            &h,
            serde_json::json!({
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": { "name": "search_assets", "arguments": { "scope": "untagged" } },
            }),
        )
        .await;
        let text = body["result"]["content"][0]["text"]
            .as_str()
            .expect("text content");
        let payload: serde_json::Value = serde_json::from_str(text).expect("json in text");
        assert_eq!(payload["total"], 2);
    }

    #[tokio::test]
    async fn view_asset_returns_image_content() {
        let h = seeded();
        let lib = h.library.clone().expect("library");
        let path = lib.thumb_path("asset000000000000001");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(&path, b"webp-bytes").expect("write thumb");

        let body = rpc(
            &h,
            serde_json::json!({
                "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": { "name": "view_asset", "arguments": { "id": "asset000000000000001" } },
            }),
        )
        .await;
        let content = body["result"]["content"].as_array().expect("content");
        let image = content
            .iter()
            .find(|part| part["type"] == "image")
            .expect("an image part");
        assert_eq!(image["mimeType"], "image/webp");
        assert!(image["data"].as_str().expect("data").len() > 4);

        // A missing thumbnail is a tool error the model can read, not a crash.
        let body = rpc(
            &h,
            serde_json::json!({
                "jsonrpc": "2.0", "id": 5, "method": "tools/call",
                "params": { "name": "view_asset", "arguments": { "id": "asset000000000000002" } },
            }),
        )
        .await;
        assert_eq!(body["result"]["isError"], true);
    }

    #[tokio::test]
    async fn protocol_mistakes_come_back_as_jsonrpc_errors() {
        let h = seeded();
        let unknown_tool = rpc(
            &h,
            serde_json::json!({
                "jsonrpc": "2.0", "id": 6, "method": "tools/call",
                "params": { "name": "delete_everything" },
            }),
        )
        .await;
        assert_eq!(unknown_tool["error"]["code"], -32602);

        let unknown_method = rpc(
            &h,
            serde_json::json!({ "jsonrpc": "2.0", "id": 7, "method": "resources/list" }),
        )
        .await;
        assert_eq!(unknown_method["error"]["code"], -32601);

        let resp = h
            .router
            .clone()
            .oneshot(request(
                "POST",
                "/mcp",
                Some(AGENT_TOKEN),
                Some("{ nope".into()),
            ))
            .await
            .expect("response");
        assert_eq!(body_json(resp).await["error"]["code"], -32700);
    }

    #[tokio::test]
    async fn the_mcp_endpoint_declines_an_sse_stream() {
        let h = seeded();
        let resp = get(&h, "/mcp").await;
        assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    /// The scan is throttled process-wide, so this test owns that window — do
    /// not add a second test that scans duplicates.
    #[tokio::test]
    async fn a_second_duplicate_scan_inside_the_window_is_429() {
        let h = seeded();
        assert_eq!(
            get(&h, "/api/agent/duplicates").await.status(),
            StatusCode::OK
        );
        let resp = get(&h, "/api/agent/duplicates").await;
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(body_json(resp).await["code"], "rate_limited");
    }
}
