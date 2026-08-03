#!/usr/bin/env node
/**
 * stdio ↔ HTTP bridge for the yAssets MCP server.
 *
 * yAssets speaks MCP over Streamable HTTP at http://127.0.0.1:<port>/mcp.
 * Clients that only support the stdio transport (older Codex builds, for
 * instance) can point at this script instead:
 *
 *   { "command": "node", "args": ["<abs path>/yassets-mcp-bridge.mjs"] }
 *
 * Zero dependencies, zero configuration: the port and token come from the
 * descriptor yAssets writes next to its settings while the Agent API is on
 * (`agent-endpoint.json`, owner-readable only). Override with YASSETS_MCP_URL
 * and YASSETS_MCP_TOKEN when running against a non-standard setup.
 *
 * Frames are newline-delimited JSON, which is what the MCP stdio transport
 * specifies — one JSON-RPC message per line, no length prefixes.
 */

import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const IDENTIFIER = "com.maosensen.yassets";
const DESCRIPTOR = "agent-endpoint.json";

/** Mirrors Tauri's `app_config_dir()` per platform. */
function configDir() {
	if (platform() === "darwin") {
		return join(homedir(), "Library", "Application Support", IDENTIFIER);
	}
	if (platform() === "win32") {
		const appData =
			process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
		return join(appData, IDENTIFIER);
	}
	const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(base, IDENTIFIER);
}

function endpoint() {
	const url = process.env.YASSETS_MCP_URL;
	const token = process.env.YASSETS_MCP_TOKEN;
	if (url && token) return { url, token };
	const path = join(configDir(), DESCRIPTOR);
	let descriptor;
	try {
		descriptor = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error(
			`could not read ${path} — open yAssets and turn on Preferences → Agent, ` +
				"or set YASSETS_MCP_URL and YASSETS_MCP_TOKEN",
		);
	}
	if (!descriptor.port || !descriptor.token) {
		throw new Error(`${path} is missing the port or token`);
	}
	return {
		url: url ?? `http://127.0.0.1:${descriptor.port}/mcp`,
		token: token ?? descriptor.token,
	};
}

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Report a failure the way the client expects — a JSON-RPC error carrying the
 * original id — so a stopped app surfaces as a readable message instead of a
 * silent hang. Notifications (no id) have nowhere to report to; stay quiet.
 */
function fail(id, message) {
	if (id === undefined || id === null) return;
	send({ jsonrpc: "2.0", id, error: { code: -32000, message } });
}

async function forward(line) {
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		send({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32700, message: "bridge received invalid JSON on stdin" },
		});
		return;
	}
	let target;
	try {
		target = endpoint();
	} catch (err) {
		fail(request.id, err.message);
		return;
	}
	let response;
	try {
		response = await fetch(target.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				authorization: `Bearer ${target.token}`,
			},
			body: line,
		});
	} catch (err) {
		fail(
			request.id,
			`yAssets is not reachable at ${target.url}: ${err.message}`,
		);
		return;
	}
	// 202 with no body is how notifications are acknowledged — nothing to relay.
	if (response.status === 202) return;
	const text = await response.text();
	if (!text) {
		if (!response.ok) fail(request.id, `yAssets replied ${response.status}`);
		return;
	}
	if (!response.ok) {
		// A transport-level refusal (401/403) is not JSON-RPC; translate it.
		try {
			const body = JSON.parse(text);
			if (body.error || body.result) {
				process.stdout.write(`${text.trim()}\n`);
				return;
			}
			fail(
				request.id,
				`yAssets replied ${response.status}: ${body.message ?? text}`,
			);
		} catch {
			fail(request.id, `yAssets replied ${response.status}: ${text}`);
		}
		return;
	}
	process.stdout.write(`${text.trim()}\n`);
}

const lines = createInterface({ input: process.stdin });
// Requests are answered in arrival order; MCP clients tolerate interleaving,
// but keeping it sequential makes the bridge trivial to reason about.
let queue = Promise.resolve();
lines.on("line", (line) => {
	if (!line.trim()) return;
	queue = queue.then(() => forward(line)).catch(() => {});
});
lines.on("close", () => {
	queue.finally(() => process.exit(0));
});
