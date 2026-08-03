/**
 * Ready-to-paste MCP client configuration for the Agent API.
 *
 * Pure string assembly, kept out of the component so it is unit-testable: a
 * wrong port or a mangled token turns into a support conversation, not a
 * compile error.
 */

/** What Preferences ▸ Agent offers to copy. */
export type AgentConfigSnippets = {
	/** One-liner for Claude Code's HTTP transport. */
	claudeCode: string;
	/** `~/.codex/config.toml` stanza driving the bundled stdio bridge. */
	codex: string | null;
	/** Generic `mcpServers` JSON for clients that take a config file. */
	json: string | null;
};

export const MCP_SERVER_NAME = "yassets";

export function mcpUrl(port: number): string {
	return `http://127.0.0.1:${port}/mcp`;
}

export function buildAgentConfigSnippets(
	port: number | null,
	token: string,
	bridgePath: string | null,
): AgentConfigSnippets | null {
	// Nothing useful to copy until the server is up and a token exists.
	if (port === null || !token) return null;
	const claudeCode = [
		`claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpUrl(port)}`,
		`--header "Authorization: Bearer ${token}"`,
	].join(" ");
	if (!bridgePath) return { claudeCode, codex: null, json: null };
	// The bridge reads the port and token from yAssets' own descriptor file, so
	// neither is baked into these snippets — rotating the token keeps them valid.
	const codex = [
		`[mcp_servers.${MCP_SERVER_NAME}]`,
		'command = "node"',
		`args = ["${bridgePath}"]`,
	].join("\n");
	const json = JSON.stringify(
		{
			mcpServers: {
				[MCP_SERVER_NAME]: { command: "node", args: [bridgePath] },
			},
		},
		null,
		2,
	);
	return { claudeCode, codex, json };
}
