//! One-click agent connection — the "make it work without reading docs" layer.
//!
//! Both connectors point the client at the bundled stdio bridge
//! (`tools/yassets-mcp-bridge.mjs`) rather than embedding the HTTP URL + token:
//! the bridge discovers the port and token from the endpoint descriptor at call
//! time, so a token rotation or a port drift never strands the configuration.
//! The HTTP one-liner remains available in Preferences as the manual fallback
//! for setups without Node.
//!
//! Two very different write paths, deliberately:
//!
//! - **Claude Code** owns its config; hand-editing `~/.claude.json` would race
//!   the CLI and skip its validation. So connecting spawns `claude mcp add`
//!   (user scope — the library is per-user, not per-repo). Detection reads the
//!   file, which is cheap and read-only.
//! - **Codex** has no config CLI; its documented contract *is*
//!   `~/.codex/config.toml`. We upsert one clearly-delimited block and keep the
//!   rest of the file byte-identical (pure function, unit-tested).

use std::path::PathBuf;

use crate::error::{AppError, AppResult};

/// Where the bundled stdio bridge lives, relative to the resource dir.
pub const BRIDGE_RESOURCE: &str = "tools/yassets-mcp-bridge.mjs";

/// The MCP server name registered with clients. Mirrored by the frontend's
/// config snippets (`src/lib/agent-config.ts`).
const SERVER_NAME: &str = "yassets";

/// Resolve the bundled bridge script, if this build carries it.
pub fn bridge_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;
    let path = app
        .path()
        .resolve(BRIDGE_RESOURCE, BaseDirectory::Resource)
        .ok()?;
    // Only advertise a path a client can actually be pointed at.
    path.exists().then(|| path.to_string_lossy().into_owned())
}

// ------------------------------------------------------------- binary lookup ---

/// Locate an executable. A GUI-launched app gets a minimal PATH (none of the
/// user's shell profile), so after the PATH sweep we check the places dev tools
/// actually install to.
fn find_binary(names: &[&str], extra_dirs: &[PathBuf]) -> Option<PathBuf> {
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for name in names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    for dir in extra_dirs {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn common_tool_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".claude/local"));
        dirs.push(home.join(".volta/bin"));
        dirs.push(home.join(".bun/bin"));
        #[cfg(windows)]
        dirs.push(home.join("AppData/Roaming/npm"));
    }
    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(windows)]
    {
        dirs.push(PathBuf::from(r"C:\Program Files\nodejs"));
    }
    dirs
}

pub fn find_claude() -> Option<PathBuf> {
    #[cfg(windows)]
    let names: &[&str] = &["claude.exe", "claude.cmd"];
    #[cfg(not(windows))]
    let names: &[&str] = &["claude"];
    find_binary(names, &common_tool_dirs())
}

pub fn find_node() -> Option<PathBuf> {
    #[cfg(windows)]
    let names: &[&str] = &["node.exe"];
    #[cfg(not(windows))]
    let names: &[&str] = &["node"];
    find_binary(names, &common_tool_dirs())
}

// -------------------------------------------------------------- Claude Code ---

fn claude_config_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".claude.json"))
}

/// Whether a parsed `~/.claude.json` registers our server (user scope stores
/// MCP servers at the top level).
fn claude_json_has_server(json: &serde_json::Value) -> bool {
    json.get("mcpServers")
        .and_then(|servers| servers.get(SERVER_NAME))
        .is_some()
}

pub fn claude_connected() -> bool {
    let Some(path) = claude_config_path() else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&raw)
        .map(|json| claude_json_has_server(&json))
        .unwrap_or(false)
}

/// Register (or re-register) the server with Claude Code by spawning its own
/// CLI — never by editing its config file behind its back. Blocking: run it
/// from `spawn_blocking`.
pub fn connect_claude(bridge: &str) -> AppResult<()> {
    let claude = find_claude().ok_or_else(|| {
        AppError::Conflict(
            "could not find the `claude` command — use the manual snippet below".into(),
        )
    })?;
    let node = find_node().ok_or_else(|| {
        AppError::Conflict(
            "the bridge needs Node.js and `node` was not found — install Node ≥18 \
             or use the manual HTTP snippet below"
                .into(),
        )
    })?;
    // Re-adding over a stale entry errors, so remove first; a failure here just
    // means there was nothing to remove.
    let _ = std::process::Command::new(&claude)
        .args(["mcp", "remove", "--scope", "user", SERVER_NAME])
        .output();
    let output = std::process::Command::new(&claude)
        .args(["mcp", "add", "--scope", "user", SERVER_NAME, "--"])
        .arg(node)
        .arg(bridge)
        .output()
        .map_err(|err| AppError::Io(format!("could not run claude: {err}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Conflict(format!(
            "claude mcp add failed: {}",
            stderr.trim()
        )));
    }
    Ok(())
}

// --------------------------------------------------------------------- Codex ---

fn codex_dir() -> Option<PathBuf> {
    Some(home_dir()?.join(".codex"))
}

/// "Codex is on this machine" — its home dir exists or its binary is findable.
pub fn codex_detected() -> bool {
    if codex_dir().is_some_and(|dir| dir.is_dir()) {
        return true;
    }
    #[cfg(windows)]
    let names: &[&str] = &["codex.exe", "codex.cmd"];
    #[cfg(not(windows))]
    let names: &[&str] = &["codex"];
    find_binary(names, &common_tool_dirs()).is_some()
}

const CODEX_BLOCK_HEADER: &str = "[mcp_servers.yassets]";

fn codex_block(bridge: &str) -> String {
    // TOML basic strings escape backslashes — matters for Windows paths.
    let escaped = bridge.replace('\\', "\\\\").replace('"', "\\\"");
    format!("{CODEX_BLOCK_HEADER}\ncommand = \"node\"\nargs = [\"{escaped}\"]\n")
}

pub fn codex_config_has_server(config: &str) -> bool {
    config.lines().any(|line| line.trim() == CODEX_BLOCK_HEADER)
}

/// Replace our block (or append it), leaving every other byte of the user's
/// config exactly as it was. A TOML table runs until the next `[` header, which
/// is all the parsing this needs — pulling in a TOML crate to round-trip a file
/// we mostly don't touch would risk reformatting the parts we don't own.
pub fn upsert_codex_block(config: &str, bridge: &str) -> String {
    let mut kept: Vec<&str> = Vec::new();
    let mut in_ours = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed == CODEX_BLOCK_HEADER {
            in_ours = true;
            continue;
        }
        if in_ours && trimmed.starts_with('[') {
            in_ours = false;
        }
        if !in_ours {
            kept.push(line);
        }
    }
    let mut result = kept.join("\n");
    // Trim the tail so repeated upserts don't accumulate blank lines.
    while result.ends_with('\n') || result.ends_with(' ') {
        result.pop();
    }
    if !result.is_empty() {
        result.push_str("\n\n");
    }
    result.push_str(&codex_block(bridge));
    result
}

pub fn codex_connected() -> bool {
    let Some(dir) = codex_dir() else { return false };
    std::fs::read_to_string(dir.join("config.toml"))
        .map(|config| codex_config_has_server(&config))
        .unwrap_or(false)
}

/// Write our block into `~/.codex/config.toml`, creating the file (and dir) if
/// this machine has Codex but no config yet.
pub fn connect_codex(bridge: &str) -> AppResult<()> {
    find_node().ok_or_else(|| {
        AppError::Conflict(
            "the bridge needs Node.js and `node` was not found — install Node ≥18 first".into(),
        )
    })?;
    let dir = codex_dir().ok_or(AppError::Internal)?;
    std::fs::create_dir_all(&dir)
        .map_err(|err| AppError::Io(format!("could not create ~/.codex: {err}")))?;
    let path = dir.join("config.toml");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let updated = upsert_codex_block(&existing, bridge);
    std::fs::write(&path, updated)
        .map_err(|err| AppError::Io(format!("could not write ~/.codex/config.toml: {err}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_into_an_empty_config_is_just_the_block() {
        let result = upsert_codex_block("", "/apps/bridge.mjs");
        assert_eq!(
            result,
            "[mcp_servers.yassets]\ncommand = \"node\"\nargs = [\"/apps/bridge.mjs\"]\n"
        );
    }

    #[test]
    fn upsert_preserves_everything_that_is_not_ours() {
        let existing = "\
model = \"o4\"\n\
\n\
[mcp_servers.other]\n\
command = \"python\"\n\
args = [\"x.py\"]\n";
        let result = upsert_codex_block(existing, "/b.mjs");
        assert!(result.contains("model = \"o4\""));
        assert!(result.contains("[mcp_servers.other]"));
        assert!(result.contains("args = [\"x.py\"]"));
        assert!(result.contains("[mcp_servers.yassets]"));
    }

    #[test]
    fn upsert_replaces_a_stale_block_instead_of_duplicating() {
        let existing = "\
[mcp_servers.yassets]\n\
command = \"node\"\n\
args = [\"/old/bridge.mjs\"]\n\
\n\
[projects]\n\
trust = true\n";
        let result = upsert_codex_block(existing, "/new/bridge.mjs");
        assert!(!result.contains("/old/bridge.mjs"));
        assert!(result.contains("/new/bridge.mjs"));
        assert!(result.contains("[projects]"), "the next table survives");
        assert_eq!(
            result.matches(CODEX_BLOCK_HEADER).count(),
            1,
            "exactly one block"
        );
    }

    #[test]
    fn upsert_is_idempotent() {
        let once = upsert_codex_block("model = \"o4\"\n", "/b.mjs");
        let twice = upsert_codex_block(&once, "/b.mjs");
        assert_eq!(once, twice);
    }

    #[test]
    fn windows_paths_are_escaped_for_toml() {
        let result = upsert_codex_block("", r"C:\Apps\yAssets\bridge.mjs");
        assert!(result.contains(r#"args = ["C:\\Apps\\yAssets\\bridge.mjs"]"#));
    }

    #[test]
    fn detection_matches_only_our_header() {
        assert!(codex_config_has_server("[mcp_servers.yassets]\n"));
        assert!(codex_config_has_server("  [mcp_servers.yassets]  \n"));
        assert!(!codex_config_has_server("[mcp_servers.yassets2]\n"));
        assert!(!codex_config_has_server("# [mcp_servers.yassets]\n"));
        assert!(!codex_config_has_server(""));
    }

    #[test]
    fn claude_detection_reads_the_user_scope_shape() {
        let json = serde_json::json!({ "mcpServers": { "yassets": { "type": "stdio" } } });
        assert!(claude_json_has_server(&json));
        let other = serde_json::json!({ "mcpServers": { "github": {} } });
        assert!(!claude_json_has_server(&other));
        assert!(!claude_json_has_server(&serde_json::json!({})));
    }
}
