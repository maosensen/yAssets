/**
 * Agent/MCP API data layer (Preferences ▸ Agent). Same shape as the Collect
 * layer: the mutations return the fresh status, so the cache is written directly
 * instead of refetching.
 */

import {
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { commands } from "@/lib/bindings";
import { describeError } from "@/lib/errors";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";
import { agentKeys } from "./keys";

export function agentStatusQueryOptions() {
	return queryOptions({
		queryKey: agentKeys.status,
		queryFn: async () => unwrap(await commands.getAgentStatus()),
	});
}

export function useSetAgentEnabled() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (enabled: boolean) =>
			unwrap(await commands.setAgentEnabled(enabled)),
		onSuccess: (status) => {
			queryClient.setQueryData(agentKeys.status, status);
		},
		onError: (error) => toast.error(describeError(error)),
	});
}

export function useRegenerateAgentToken() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () => unwrap(await commands.regenerateAgentToken()),
		onSuccess: (status) => {
			queryClient.setQueryData(agentKeys.status, status);
			toast.success(T.agent.regenerated);
		},
		onError: (error) => toast.error(describeError(error)),
	});
}

export function agentConnectionsQueryOptions() {
	return queryOptions({
		queryKey: agentKeys.connections,
		queryFn: async () => unwrap(await commands.getAgentConnections()),
	});
}

/** One-click connect. `target` picks the client; both go through the bridge. */
export function useConnectAgent() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (target: "claudeCode" | "codex") =>
			unwrap(
				await (target === "claudeCode"
					? commands.connectClaudeCode()
					: commands.connectCodex()),
			),
		onSuccess: (connections, target) => {
			queryClient.setQueryData(agentKeys.connections, connections);
			toast.success(
				T.agent.connectedToast(
					target === "claudeCode" ? "Claude Code" : "Codex",
				),
			);
		},
		onError: (error) => toast.error(describeError(error)),
	});
}
