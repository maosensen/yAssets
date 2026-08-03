//! MCP (Model Context Protocol) over Streamable HTTP, hand-rolled.
//!
//! Stateless by design: no `Mcp-Session-Id`, no SSE stream, no server→client
//! notifications — the spec permits all three omissions, and everything an
//! agent needs here is request/response. That keeps the whole protocol surface
//! to five methods (`initialize`, `notifications/initialized`, `ping`,
//! `tools/list`, `tools/call`) and about a page of dispatch, which is why this
//! is plain serde rather than a new MCP SDK dependency.
//!
//! Tool handlers delegate to `super::api`, the same layer the REST routes use.
//! Execution failures come back as `isError: true` tool results (the model can
//! read and recover from those); only protocol-level mistakes — unknown method,
//! unknown tool, unparseable arguments — become JSON-RPC errors.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use super::api;
use super::dto::SearchRequest;
use crate::error::AppError;

/// The protocol revision this server speaks.
const PROTOCOL_VERSION: &str = "2025-06-18";

/// Ceiling on images returned by `view_assets`. A single tool result that
/// inlines dozens of pictures buys nothing and costs the whole context window.
const MAX_VIEW_BATCH: usize = 8;

const PARSE_ERROR: i32 = -32700;
const METHOD_NOT_FOUND: i32 = -32601;
const INVALID_PARAMS: i32 = -32602;

#[derive(Debug, Deserialize)]
struct RpcRequest {
    /// Present on requests, absent on notifications — that distinction is the
    /// only thing that decides whether we answer at all.
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

pub async fn handle<R: tauri::Runtime>(app: &tauri::AppHandle<R>, body: &[u8]) -> Response {
    let request: RpcRequest = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(err) => {
            // No id is recoverable from an unparseable frame, so id is null.
            return rpc_error(Value::Null, PARSE_ERROR, format!("invalid JSON: {err}"));
        }
    };

    // Notifications get no body — acknowledging with 202 is what the spec asks
    // for and what clients wait on after `initialize`.
    let Some(id) = request.id.clone() else {
        return StatusCode::ACCEPTED.into_response();
    };

    match request.method.as_str() {
        "initialize" => rpc_result(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "yassets",
                    "title": "yAssets library",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "instructions": INSTRUCTIONS,
            }),
        ),
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(id, json!({ "tools": tool_specs() })),
        "tools/call" => call_tool(app, id, request.params).await,
        // A notification that arrived with an id — answer rather than hang.
        other if other.starts_with("notifications/") => rpc_result(id, json!({})),
        other => rpc_error(
            id,
            METHOD_NOT_FOUND,
            format!(
                "this server implements initialize, ping, tools/list and tools/call — not {other}"
            ),
        ),
    }
}

const INSTRUCTIONS: &str = "\
yAssets is a local asset library. Start with library_stats to see how much is \
uncategorized or untagged, list_tags and list_folders to learn the vocabulary \
that already exists, then search_assets to pull a small batch and view_asset(s) \
to actually look at the pictures before proposing tags or folders. This surface \
is read-only: report what you would change, do not expect to write.";

fn rpc_result(id: Value, result: Value) -> Response {
    (
        StatusCode::OK,
        Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })),
    )
        .into_response()
}

fn rpc_error(id: Value, code: i32, message: impl Into<String>) -> Response {
    // JSON-RPC transports errors in the body, so the HTTP status stays 200 —
    // clients read `error`, not the status line.
    (
        StatusCode::OK,
        Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message.into() },
        })),
    )
        .into_response()
}

fn text_result(id: Value, text: String) -> Response {
    rpc_result(id, json!({ "content": [{ "type": "text", "text": text }] }))
}

fn json_result(id: Value, value: &Value) -> Response {
    text_result(
        id,
        serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
    )
}

/// A failed tool call the model can see and react to (wrong id, no library,
/// asset without a thumbnail) — deliberately not a JSON-RPC error.
fn tool_failure(id: Value, err: &AppError) -> Response {
    rpc_result(
        id,
        json!({
            "content": [{ "type": "text", "text": err.to_string() }],
            "isError": true,
        }),
    )
}

#[derive(Debug, Deserialize)]
struct CallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
}

async fn call_tool<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: Value,
    params: Value,
) -> Response {
    let params: CallParams = match serde_json::from_value(params) {
        Ok(params) => params,
        Err(err) => return rpc_error(id, INVALID_PARAMS, format!("bad tools/call params: {err}")),
    };
    let args = if params.arguments.is_null() {
        json!({})
    } else {
        params.arguments
    };

    match params.name.as_str() {
        "search_assets" => {
            let request: SearchRequest = match serde_json::from_value(args) {
                Ok(request) => request,
                Err(err) => {
                    return rpc_error(id, INVALID_PARAMS, format!("bad search arguments: {err}"))
                }
            };
            match api::search(app, request).await {
                Ok(page) => json_result(id, &to_value(&page)),
                Err(err) => tool_failure(id, &err),
            }
        }
        "get_asset" => match string_arg(&args, "id") {
            Ok(asset_id) => match api::detail(app, &asset_id).await {
                Ok(detail) => json_result(id, &to_value(&detail)),
                Err(err) => tool_failure(id, &err),
            },
            Err(message) => rpc_error(id, INVALID_PARAMS, message),
        },
        "view_asset" => match string_arg(&args, "id") {
            Ok(asset_id) => view(app, id, vec![asset_id]).await,
            Err(message) => rpc_error(id, INVALID_PARAMS, message),
        },
        "view_assets" => match string_list_arg(&args, "ids") {
            Ok(ids) => view(app, id, ids).await,
            Err(message) => rpc_error(id, INVALID_PARAMS, message),
        },
        "list_tags" => match api::tags(app).await {
            Ok(tags) => json_result(id, &to_value(&tags)),
            Err(err) => tool_failure(id, &err),
        },
        "list_folders" => match api::folders(app).await {
            Ok(folders) => json_result(id, &to_value(&folders)),
            Err(err) => tool_failure(id, &err),
        },
        "list_smart_folders" => match api::smart_folders(app).await {
            Ok(folders) => json_result(id, &to_value(&folders)),
            Err(err) => tool_failure(id, &err),
        },
        "library_stats" => match api::stats(app).await {
            Ok(stats) => json_result(id, &to_value(&stats)),
            Err(err) => tool_failure(id, &err),
        },
        "find_similar" => match string_arg(&args, "id") {
            Ok(asset_id) => {
                let max_distance = args
                    .get("maxDistance")
                    .and_then(Value::as_u64)
                    .unwrap_or(10) as u32;
                match api::similar(app, &asset_id, max_distance).await {
                    Ok(rows) => json_result(id, &to_value(&rows)),
                    Err(err) => tool_failure(id, &err),
                }
            }
            Err(message) => rpc_error(id, INVALID_PARAMS, message),
        },
        "find_duplicates" => match api::duplicates(app).await {
            Ok(scan) => json_result(id, &to_value(&scan)),
            Err(err) => tool_failure(id, &err),
        },
        other => rpc_error(
            id,
            INVALID_PARAMS,
            format!("unknown tool {other:?} — call tools/list for what this server offers"),
        ),
    }
}

fn to_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

fn string_arg(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{key} is required and must be a non-empty string"))
}

fn string_list_arg(args: &Value, key: &str) -> Result<Vec<String>, String> {
    let list = args
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{key} is required and must be an array of asset ids"))?;
    if list.is_empty() {
        return Err(format!("{key} must not be empty"));
    }
    if list.len() > MAX_VIEW_BATCH {
        return Err(format!(
            "{key} accepts at most {MAX_VIEW_BATCH} ids per call — page through larger sets"
        ));
    }
    list.iter()
        .map(|value| {
            value
                .as_str()
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .ok_or_else(|| format!("{key} must contain only non-empty asset id strings"))
        })
        .collect()
}

/// Thumbnails as MCP image content — this is what lets a multimodal model
/// actually see the library instead of guessing from filenames. A name label
/// precedes each image so the model can tie a picture back to its id.
async fn view<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: Value,
    asset_ids: Vec<String>,
) -> Response {
    let mut content: Vec<Value> = Vec::with_capacity(asset_ids.len() * 2);
    let mut failures = 0usize;
    for asset_id in &asset_ids {
        match api::thumb_bytes(app, asset_id).await {
            Ok(bytes) => {
                content.push(json!({ "type": "text", "text": format!("asset {asset_id}") }));
                content.push(json!({
                    "type": "image",
                    "mimeType": "image/webp",
                    "data": base64::engine::general_purpose::STANDARD.encode(&bytes),
                }));
            }
            Err(err) => {
                failures += 1;
                content.push(json!({
                    "type": "text",
                    "text": format!("asset {asset_id}: {err}"),
                }));
            }
        }
    }
    // Every requested asset failed → the call as a whole failed.
    let all_failed = failures == asset_ids.len();
    rpc_result(id, json!({ "content": content, "isError": all_failed }))
}

/// Tool declarations. The descriptions are prompts, not documentation — they
/// have to tell the model *when* to reach for each one and how not to drown
/// itself in results.
pub(crate) fn tool_specs() -> Vec<Value> {
    let asset_id = json!({ "type": "string", "description": "Asset id from search_assets." });
    vec![
        json!({
            "name": "search_assets",
            "description": "Search the library. Returns compact rows plus `total` and `nextOffset`. \
        Default page size is 50, maximum 200 — start narrow and page with `offset` instead of asking for \
        everything. Pass include:[\"tags\",\"folders\"] when you need to reason about how assets are \
        currently organized.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Full-text over name and note." },
                    "scope": {
                        "description": "\"all\" | \"uncategorized\" | \"untagged\" | \"trash\", or an object: {\"folder\":\"id\"}, {\"tag\":\"id\"}, {\"smartFolder\":\"id\"}, {\"recentDays\":7}, {\"hue\":3}.",
                    },
                    "ratingMin": { "type": "integer", "minimum": 0, "maximum": 5 },
                    "ext": {
                        "type": "array", "items": { "type": "string" },
                        "description": "Lowercase extensions, any-of, e.g. [\"png\",\"jpg\"].",
                    },
                    "tags": {
                        "type": "array", "items": { "type": "string" },
                        "description": "Tag ids, any-of.",
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["imported_at", "name", "size", "rating", "updated_at"],
                    },
                    "dir": { "type": "string", "enum": ["asc", "desc"] },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 },
                    "offset": { "type": "integer", "minimum": 0 },
                    "include": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["tags", "folders"] },
                    },
                },
            },
        }),
        json!({
            "name": "get_asset",
            "description": "Full metadata for one asset: note, tags, folder ids, palette, source URL, timestamps.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": asset_id },
                "required": ["id"],
            },
        }),
        json!({
            "name": "view_asset",
            "description": "Look at an asset — returns its thumbnail as an image. Use this before \
        suggesting tags or grouping: filenames lie, pixels do not.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": asset_id },
                "required": ["id"],
            },
        }),
        json!({
            "name": "view_assets",
            "description": format!(
                "Look at several assets in one call (at most {MAX_VIEW_BATCH}). Prefer this over \
        repeated view_asset calls when triaging a batch."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "maxItems": MAX_VIEW_BATCH,
                    },
                },
                "required": ["ids"],
            },
        }),
        json!({
            "name": "list_tags",
            "description": "Every tag with how many assets carry it. Read this before proposing tags \
        so you reuse the user's existing vocabulary instead of inventing synonyms.",
            "inputSchema": { "type": "object", "properties": {} },
        }),
        json!({
            "name": "list_folders",
            "description": "Flat folder list with parentId, position and asset counts — build the tree yourself.",
            "inputSchema": { "type": "object", "properties": {} },
        }),
        json!({
            "name": "list_smart_folders",
            "description": "Saved rule sets (live queries). Shows the organizing logic the user already trusts.",
            "inputSchema": { "type": "object", "properties": {} },
        }),
        json!({
            "name": "library_stats",
            "description": "Totals: assets, uncategorized, untagged, trashed, bytes. The cheapest way \
        to see where the work is.",
            "inputSchema": { "type": "object", "properties": {} },
        }),
        json!({
            "name": "find_similar",
            "description": "Perceptually similar assets (dHash), nearest first. maxDistance 0-20, default 10.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": asset_id,
                    "maxDistance": { "type": "integer", "minimum": 0, "maximum": 20 },
                },
                "required": ["id"],
            },
        }),
        json!({
            "name": "find_duplicates",
            "description": "Whole-library scan: byte-identical groups and visually-similar clusters. \
        Expensive — at most once every 30 seconds.",
            "inputSchema": { "type": "object", "properties": {} },
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names() -> Vec<String> {
        tool_specs()
            .iter()
            .map(|spec| spec["name"].as_str().expect("name").to_string())
            .collect()
    }

    #[test]
    fn the_tool_list_is_exactly_the_read_only_surface() {
        let mut actual = names();
        actual.sort();
        let mut expected = vec![
            "find_duplicates",
            "find_similar",
            "get_asset",
            "library_stats",
            "list_folders",
            "list_smart_folders",
            "list_tags",
            "search_assets",
            "view_asset",
            "view_assets",
        ];
        expected.sort();
        assert_eq!(actual, expected);
    }

    /// Phase A is read-only, and some capabilities stay off-limits even later:
    /// irreversible deletes and anything that needs a host path. Adding one of
    /// these back must be a deliberate act, not a copy-paste.
    #[test]
    fn no_destructive_or_path_taking_tool_can_sneak_in() {
        let forbidden = [
            "delete_assets_forever",
            "empty_trash",
            "clean_orphans",
            "vacuum_database",
            "open_library",
            "create_library",
            "close_library",
            "import_paths",
            "export_assets",
            "reveal_asset",
            "start_asset_drag",
            "copy_assets_to_clipboard",
        ];
        let names = names();
        for name in forbidden {
            assert!(
                !names.contains(&name.to_string()),
                "{name} must not be exposed"
            );
        }
        // Phase A additionally exposes no writes at all.
        for name in &names {
            for verb in [
                "tag_", "rate_", "trash_", "update_", "create_", "delete_", "move_",
            ] {
                assert!(
                    !name.starts_with(verb),
                    "{name} looks like a mutation, but this surface is read-only"
                );
            }
        }
    }

    #[test]
    fn every_tool_declares_an_object_input_schema() {
        for spec in tool_specs() {
            let name = spec["name"].as_str().expect("name");
            assert_eq!(
                spec["inputSchema"]["type"].as_str(),
                Some("object"),
                "{name} needs an object inputSchema"
            );
            assert!(
                spec["description"].as_str().is_some_and(|d| d.len() > 40),
                "{name} needs a description that tells the model when to use it"
            );
        }
    }

    #[test]
    fn view_batches_are_bounded() {
        let args = json!({ "ids": vec!["asset000000000000001"; MAX_VIEW_BATCH + 1] });
        let err = string_list_arg(&args, "ids").expect_err("over the cap");
        assert!(err.contains(&MAX_VIEW_BATCH.to_string()), "{err}");
        assert!(string_list_arg(&json!({ "ids": [] }), "ids").is_err());
        assert!(string_list_arg(&json!({}), "ids").is_err());
        assert!(string_list_arg(&json!({ "ids": ["a", 2] }), "ids").is_err());
        assert_eq!(
            string_list_arg(&json!({ "ids": ["a", "b"] }), "ids").unwrap(),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn string_args_reject_blanks_and_wrong_types() {
        assert!(string_arg(&json!({ "id": "abc" }), "id").is_ok());
        assert!(string_arg(&json!({ "id": "" }), "id").is_err());
        assert!(string_arg(&json!({ "id": 7 }), "id").is_err());
        assert!(string_arg(&json!({}), "id").is_err());
    }
}
