/**
 * Tag-domain data layer. Assignment mutations invalidate broadly on purpose:
 * tag counts, the untagged badge, tag-scoped lists, and the asset detail all
 * move together.
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
import { assetKeys, libraryKeys, tagKeys } from "./keys";

export function tagsQueryOptions() {
	return queryOptions({
		queryKey: tagKeys.all,
		queryFn: async () => unwrap(await commands.listTags()),
	});
}

function invalidateTags(queryClient: QueryClient) {
	void queryClient.invalidateQueries({ queryKey: tagKeys.all });
	void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
}

function invalidateTagsAndAssets(queryClient: QueryClient) {
	invalidateTags(queryClient);
	void queryClient.invalidateQueries({ queryKey: assetKeys.all });
}

const onToastError = (error: unknown) => toast.error(describeError(error));

export function useCreateTag() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { name: string; color?: string | null }) =>
			unwrap(await commands.createTag(input.name, input.color ?? null)),
		onSuccess: () => invalidateTags(queryClient),
		onError: onToastError,
	});
}

export function useUpdateTag() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { id: string; name?: string; color?: string }) =>
			unwrap(
				await commands.updateTag(
					input.id,
					input.name ?? null,
					input.color ?? null,
				),
			),
		// Renames surface in detail chips too.
		onSuccess: () => invalidateTagsAndAssets(queryClient),
		onError: onToastError,
	});
}

export function useDeleteTag() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => unwrap(await commands.deleteTag(id)),
		onSuccess: () => invalidateTagsAndAssets(queryClient),
		onError: onToastError,
	});
}

export function useAddTagsToAssets() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { assetIds: string[]; tagIds: string[] }) =>
			unwrap(await commands.addTagsToAssets(input.assetIds, input.tagIds)),
		onSuccess: () => invalidateTagsAndAssets(queryClient),
		onError: onToastError,
	});
}

export function useRemoveTagsFromAssets() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { assetIds: string[]; tagIds: string[] }) =>
			unwrap(await commands.removeTagsFromAssets(input.assetIds, input.tagIds)),
		onSuccess: () => invalidateTagsAndAssets(queryClient),
		onError: onToastError,
	});
}

/**
 * Create-or-get a tag by name, then attach it to the assets — the picker's
 * "type name, press enter" path in one call.
 */
export function useTagAssetsByName() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { assetIds: string[]; name: string }) => {
			const tag = unwrap(await commands.createTag(input.name, null));
			return unwrap(await commands.addTagsToAssets(input.assetIds, [tag.id]));
		},
		onSuccess: () => invalidateTagsAndAssets(queryClient),
		onError: onToastError,
	});
}
