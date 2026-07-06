/**
 * Watched-folders data layer (Preferences ▸ Watched Folders). CRUD over the v8
 * table; the backend restarts the live watcher after each change, so the UI just
 * invalidates the list.
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
import { watchedFolderKeys } from "./keys";

export function watchedFoldersQueryOptions() {
	return queryOptions({
		queryKey: watchedFolderKeys.all,
		queryFn: async () => unwrap(await commands.listWatchedFolders()),
	});
}

export function useAddWatchedFolder() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { path: string; folderId: string | null }) =>
			unwrap(await commands.addWatchedFolder(input.path, input.folderId)),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: watchedFolderKeys.all });
		},
		onError: (error) => toast.error(describeError(error)),
	});
}

export function useSetWatchedFolderEnabled() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { id: string; enabled: boolean }) =>
			unwrap(await commands.setWatchedFolderEnabled(input.id, input.enabled)),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: watchedFolderKeys.all });
		},
		onError: (error) => toast.error(describeError(error)),
	});
}

export function useRemoveWatchedFolder() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) =>
			unwrap(await commands.removeWatchedFolder(id)),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: watchedFolderKeys.all });
		},
		onError: (error) => toast.error(describeError(error)),
	});
}
