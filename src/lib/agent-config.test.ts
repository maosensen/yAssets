import { describe, expect, it } from "vitest";
import { buildAgentConfigSnippets, mcpUrl } from "./agent-config";

describe("buildAgentConfigSnippets", () => {
	it("has nothing to offer until the server is up with a token", () => {
		expect(buildAgentConfigSnippets(null, "tok", "/b.mjs")).toBeNull();
		expect(buildAgentConfigSnippets(41420, "", "/b.mjs")).toBeNull();
	});

	it("builds the Claude Code one-liner with the live port and token", () => {
		const snippets = buildAgentConfigSnippets(41422, "s3cret", null);
		expect(snippets?.claudeCode).toBe(
			'claude mcp add --transport http yassets http://127.0.0.1:41422/mcp --header "Authorization: Bearer s3cret"',
		);
	});

	it("omits the bridge snippets when this build ships no bridge", () => {
		const snippets = buildAgentConfigSnippets(41420, "tok", null);
		expect(snippets?.codex).toBeNull();
		expect(snippets?.json).toBeNull();
	});

	it("points the bridge snippets at the script, never at the token", () => {
		const snippets = buildAgentConfigSnippets(
			41420,
			"tok",
			"/Applications/yAssets.app/Contents/Resources/tools/yassets-mcp-bridge.mjs",
		);
		expect(snippets?.codex).toContain("[mcp_servers.yassets]");
		expect(snippets?.codex).toContain("yassets-mcp-bridge.mjs");
		// The bridge discovers the token itself; embedding it would strand the
		// config the moment the user rotates it.
		expect(snippets?.codex).not.toContain("tok");
		expect(snippets?.json).not.toContain("tok");
		expect(JSON.parse(snippets?.json ?? "{}")).toEqual({
			mcpServers: {
				yassets: {
					command: "node",
					args: [
						"/Applications/yAssets.app/Contents/Resources/tools/yassets-mcp-bridge.mjs",
					],
				},
			},
		});
	});

	it("keeps the endpoint on loopback", () => {
		expect(mcpUrl(41424)).toBe("http://127.0.0.1:41424/mcp");
	});
});
