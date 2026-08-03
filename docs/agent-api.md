# Agent API

A loopback-only, read-only surface that lets an AI coding agent (Claude Code,
Codex, anything that speaks MCP) browse a yAssets library: search it, read
metadata, and *look at* the thumbnails.

Off by default. Enable it in **Preferences ▸ Agent**, which provisions a bearer
token and prints ready-to-paste client config.

## Why it goes through the running app

An agent must not open the library's SQLite directly, even for reads:

- writes are serialized by an in-process writer mutex (`Library::write`); an
  external writer bypasses it;
- the UI refreshes off query invalidation and typed events, so an outside
  mutation leaves every open view showing stale rows;
- thumbnails, the FTS index, dHash fingerprints and palettes are derived data
  maintained by the import pipeline — a raw `INSERT` produces half-cataloged
  assets.

So the shape is: **MCP client → HTTP on 127.0.0.1 → running yAssets → the same
command cores the UI uses.** With the app closed, requests simply fail.

## Security model

Three independent gates, all of them in front of every route:

| Gate | Behaviour |
| --- | --- |
| Transport | Binds `127.0.0.1` only, on the first free port in `41420-41424`. `Host` must be exactly `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` (DNS-rebinding defence). |
| Origin | Allowed when **absent** (CLI, MCP clients) or a browser-extension scheme. A web page's `fetch` always sends `Origin`, so pages are refused — and no CORS headers are emitted either way. |
| Token | 48-char nanoid, compared in constant time, `Authorization: Bearer <token>`. Separate key from the Collect token (`agent_token` vs `collect_token`): revoking one leaves the other working. |

Plus: the enable flag is checked per request, so a listener held open by the
Collect surface does not expose the agent routes.

**No absolute paths cross this boundary.** `AssetDetail::src_path` is reduced to
its basename (`srcFilename`), the library reports its name but not its location,
and the library-management commands are not exposed at all. Asset ids are
validated (10-32 chars, lowercase alphanumerics) before any path is built, so no
request can produce a path segment.

The endpoint descriptor `<appConfigDir>/agent-endpoint.json` (`{port, token}`,
mode `0600`) exists only while the surface is on; it is what makes the stdio
bridge zero-config. The token never appears in logs.

## What is *not* exposed

Not now, and — for the first four — not when write support lands either:

`delete_assets_forever`, `empty_trash`, `clean_orphans`, `vacuum_database`,
`create/open/close_library`, `import_paths`, `export_assets`, `reveal_asset`,
`start_asset_drag`, `copy_assets_to_clipboard`.

Two reasons, one per group: irreversible, or requires a host path. A unit test
asserts none of these names can appear in `tools/list`.

## Connecting a client

**Claude Code** (HTTP transport — no extra process):

```bash
claude mcp add --transport http yassets http://127.0.0.1:41420/mcp \
  --header "Authorization: Bearer <token>"
```

**stdio clients** (older Codex builds) go through the bundled bridge, which reads
the port and token from the descriptor — so it survives a token rotation:

```toml
[mcp_servers.yassets]
command = "node"
args = ["<resource dir>/tools/yassets-mcp-bridge.mjs"]
```

Preferences ▸ Agent prints both snippets with the live port, plus the bridge's
absolute path. Override the bridge's discovery with `YASSETS_MCP_URL` and
`YASSETS_MCP_TOKEN` if needed.

## MCP tools

Stateless Streamable HTTP at `POST /mcp`; `GET /mcp` returns 405 (the server
never pushes, so there is no SSE stream). Implemented methods: `initialize`,
`notifications/initialized`, `ping`, `tools/list`, `tools/call`.

| Tool | Purpose |
| --- | --- |
| `search_assets` | The main query. Compact rows + `total` + `nextOffset`. |
| `get_asset` | Full metadata for one asset. |
| `view_asset` / `view_assets` | The thumbnail(s) as MCP image content — max 8 per call. |
| `list_tags`, `list_folders`, `list_smart_folders` | The organizing vocabulary that already exists. |
| `library_stats` | Totals, including how much is uncategorized/untagged. |
| `find_similar` | Perceptually similar assets (dHash). |
| `find_duplicates` | Whole-library scan; at most once every 30 s. |

Tool-execution failures come back as `isError: true` results (the model can read
and recover); only protocol mistakes become JSON-RPC errors (`-32700` parse,
`-32601` unknown method, `-32602` unknown tool / bad arguments).

## REST endpoints

Same data, for curl and for clients that would rather not speak MCP. All under
`/api/agent/`, all requiring the token.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `info` | Identity, `libraryOpen`, `readOnly`, capabilities, limits. |
| POST | `search` | Body below. An empty body means "newest 50". |
| GET | `assets/{id}` | Detail. |
| GET | `assets/{id}/similar?maxDistance=` | Default 10, clamped to 20. |
| GET | `assets/{id}/thumb` | WebP bytes. |
| GET | `assets/{id}/file` | Original bytes; 422 above 20 MB. |
| GET | `folders`, `folders/{id}/stats` | Flat list (build the tree client-side). |
| GET | `tags`, `smart-folders`, `stats` | |
| GET | `duplicates` | Throttled to one scan per 30 s. |

### Search body

```jsonc
{
  "query": "sunset",              // full-text over name + note
  "scope": "untagged",            // all | uncategorized | untagged | trash
                                  // or {"folder":"id"} {"tag":"id"} {"smartFolder":"id"}
                                  //    {"recentDays":7} {"hue":3}
  "ratingMin": 3,
  "ext": ["png", "jpg"],          // any-of
  "tags": ["tagId"],              // any-of, stacks on top of scope
  "sort": "imported_at",          // imported_at | name | size | rating | updated_at
  "dir": "desc",
  "limit": 50,                    // default 50, clamped to 200
  "offset": 0,
  "include": ["tags", "folders"]  // opt-in joins
}
```

Every field is optional. Unknown `include` values are ignored; an unknown
`scope` is a 422 that names the accepted vocabulary.

### Errors

`{ "code": …, "message": … }` — the same envelope the Collect API uses.

| Code | Status | |
| --- | --- | --- |
| `agent_disabled` | 403 | Surface switched off. |
| `forbidden` | 403 | Bad `Host` or a browser `Origin`. |
| `unauthorized` | 401 | Missing/wrong token. |
| `no_library` | 409 | No library open in the app. |
| `not_found` | 404 | Unknown or malformed asset/folder id. |
| `invalid` | 422 | Bad body, bad scope, oversized file. |
| `rate_limited` | 429 | Duplicate scan inside the window. |
| `internal` | 500 | |

## Code map

| Path | |
| --- | --- |
| `src-tauri/src/agent/mod.rs` | Flag, token, endpoint descriptor, `AgentCtx`. |
| `src-tauri/src/agent/api.rs` | Data layer — the single implementation behind both façades. |
| `src-tauri/src/agent/dto.rs` | Wire types + the redaction, with their tests. |
| `src-tauri/src/agent/routes.rs` | axum router, auth gate, router-level tests. |
| `src-tauri/src/agent/mcp.rs` | JSON-RPC + tool declarations. |
| `src-tauri/src/collect/mod.rs` | Owns the shared listener (either surface keeps it up). |
| `src-tauri/src/commands/agent.rs` | `get_agent_status` / `set_agent_enabled` / `regenerate_agent_token`. |
| `tools/yassets-mcp-bridge.mjs` | stdio ↔ HTTP bridge (bundled as a resource). |
