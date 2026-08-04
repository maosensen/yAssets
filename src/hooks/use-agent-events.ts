/**
 * Writes arriving through the Agent API (Claude Code, Codex, …) bypass the
 * frontend mutation layer entirely — the Rust server writes and then emits
 * `AgentMutated`. This hook (mounted once in AppShell) toasts the change and
 * invalidates everything an organize-style write can move, so the grid, sidebar
 * and badges catch up without the user touching anything.
 *
 * Without it the app would keep showing pre-write rows and the user's next edit
 * would be based on stale state — the whole reason agent writes route through
 * the running app instead of the library's SQLite.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { events } from "@/lib/bindings";
import {
	assetKeys,
	folderKeys,
	libraryKeys,
	smartFolderKeys,
	tagKeys,
} from "@/lib/queries/keys";
import { T } from "@/lib/text";

export function useAgentEvents() {
	const queryClient = useQueryClient();

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		void events.agentMutated
			.listen((event) => {
				const { tool, affected } = event.payload;
				toast.info(T.agent.toastMutated(tool, affected));
				// A write can touch tags, folders and counters at once (creating a
				// tag while tagging, say), so refresh the whole organize surface
				// rather than guessing from the tool name.
				for (const key of [
					assetKeys.all,
					folderKeys.all,
					tagKeys.all,
					smartFolderKeys.all,
					libraryKeys.stats,
				]) {
					void queryClient.invalidateQueries({ queryKey: key });
				}
			})
			.then((fn) => {
				if (disposed) fn();
				else unlisten = fn;
			});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [queryClient]);
}
