/**
 * Folder-domain data layer: list query + CRUD/membership mutation hooks.
 * Every mutation invalidates precisely what it can move: the folder list
 * (counts), asset lists (membership-scoped views), and the sidebar stats.
 */

import {
	type QueryClient,
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { commands } from "@/lib/bindings";
import { describeError } from "@/lib/errors";
import { unwrap } from "@/lib/tauri";
import { assetKeys, folderKeys, libraryKeys } from "./keys";

export function foldersQueryOptions() {
	return queryOptions({
		queryKey: folderKeys.all,
		queryFn: async () => unwrap(await commands.listFolders()),
	});
}

export function folderStatsQueryOptions(folderId: string) {
	return queryOptions({
		queryKey: folderKeys.stats(folderId),
		queryFn: async () => unwrap(await commands.getFolderStats(folderId)),
	});
}

function invalidateFolders(queryClient: QueryClient) {
	void queryClient.invalidateQueries({ queryKey: folderKeys.all });
	void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
}

function invalidateFoldersAndAssets(queryClient: QueryClient) {
	invalidateFolders(queryClient);
	void queryClient.invalidateQueries({ queryKey: assetKeys.all });
}

const onToastError = (error: unknown) => toast.error(describeError(error));

export function useCreateFolder() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { name: string; parentId?: string | null }) =>
			unwrap(await commands.createFolder(input.name, input.parentId ?? null)),
		onSuccess: () => invalidateFolders(queryClient),
		onError: onToastError,
	});
}

export function useRenameFolder() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { id: string; name: string }) =>
			unwrap(await commands.renameFolder(input.id, input.name)),
		onSuccess: () => invalidateFolders(queryClient),
		onError: onToastError,
	});
}

export function useSetFolderDescription() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { id: string; description: string }) =>
			unwrap(await commands.setFolderDescription(input.id, input.description)),
		onSuccess: () => invalidateFolders(queryClient),
		onError: onToastError,
	});
}

export function useDeleteFolder() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => unwrap(await commands.deleteFolder(id)),
		// Subtree members fall back to "uncategorized" → asset views shift too.
		onSuccess: () => invalidateFoldersAndAssets(queryClient),
		onError: onToastError,
	});
}

export function useAddAssetsToFolder() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { assetIds: string[]; folderId: string }) =>
			unwrap(await commands.addAssetsToFolder(input.assetIds, input.folderId)),
		onSuccess: () => invalidateFoldersAndAssets(queryClient),
		onError: onToastError,
	});
}

export function useRemoveAssetsFromFolder() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { assetIds: string[]; folderId: string }) =>
			unwrap(
				await commands.removeAssetsFromFolder(input.assetIds, input.folderId),
			),
		onSuccess: () => invalidateFoldersAndAssets(queryClient),
		onError: onToastError,
	});
}
