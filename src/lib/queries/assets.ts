/**
 * Asset-domain data layer.
 *
 * Phase-1 list strategy: ONE full fetch per view (`limit: 50000`) — masonry
 * wants every aspect ratio up front, optimistic updates work on a single
 * array, and offset-drift during concurrent imports can't happen. The IPC
 * contract stays paged, so switching to keyset+infinite later is additive.
 */

import {
	type QueryClient,
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
	type AssetDetail,
	type AssetListResult,
	type AssetScope,
	commands,
	type SortDir,
	type SortKey,
} from "@/lib/bindings";
import { describeError } from "@/lib/errors";
import { extsForKinds } from "@/lib/file-kinds";
import { type LibraryView, scopeFromView } from "@/lib/library-view";
import { useCoverBustStore } from "@/lib/stores/cover-bust-store";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";
import { captureVideoCover } from "@/lib/video-cover";
import { assetKeys, folderKeys, libraryKeys } from "./keys";

const FULL_FETCH_LIMIT = 50_000;

export type AssetListParams = {
	scope: AssetScope;
	search?: string;
	/** Ad-hoc facets applied on top of scope (orthogonal). */
	ratingMin?: number;
	types?: string[];
	tags?: string[];
	sort: SortKey;
	dir: SortDir;
};

function scopeKeyPart(scope: AssetScope): {
	view: string;
	folderId?: string;
	tagId?: string;
	hue?: number;
	smartFolderId?: string;
} {
	switch (scope.kind) {
		case "folder":
			return { view: "folder", folderId: scope.folder_id };
		case "tag":
			return { view: "tag", tagId: scope.tag_id };
		// Discriminator MUST be in the key — else all hues / all smart folders
		// share one cache entry and show whichever loaded first/last.
		case "color":
			return { view: "color", hue: scope.hue };
		case "smart_folder":
			return { view: "smart_folder", smartFolderId: scope.smart_folder_id };
		default:
			return { view: scope.kind };
	}
}

export function assetListQueryOptions(params: AssetListParams) {
	const { view, folderId, tagId, hue, smartFolderId } = scopeKeyPart(
		params.scope,
	);
	const search = params.search?.trim() || undefined;
	// Normalize facets: drop empties, sort arrays so key/order is stable.
	const ratingMin =
		params.ratingMin && params.ratingMin > 0 ? params.ratingMin : undefined;
	const types =
		params.types && params.types.length > 0
			? [...params.types].sort()
			: undefined;
	const tags =
		params.tags && params.tags.length > 0 ? [...params.tags].sort() : undefined;
	return queryOptions({
		queryKey: assetKeys.list({
			view,
			folderId,
			tagId,
			hue,
			smartFolderId,
			q: search,
			ratingMin,
			types,
			tags,
			sortBy: params.sort,
			sortDir: params.dir,
		}),
		queryFn: async () =>
			unwrap(
				await commands.listAssets({
					scope: params.scope,
					search: search ?? null,
					rating_min: ratingMin ?? null,
					types: types ?? null,
					tag_ids: tags ?? null,
					sort: params.sort,
					dir: params.dir,
					offset: null,
					limit: FULL_FETCH_LIMIT,
				}),
			),
	});
}

export function assetDetailQueryOptions(id: string) {
	return queryOptions({
		queryKey: assetKeys.detail(id),
		queryFn: async () => unwrap(await commands.getAsset(id)),
	});
}

/** Hamming distance ceiling for "looks similar" (find-similar view). */
const SIMILAR_DISTANCE = 10;

/**
 * dHash neighborhood of `id`, ranked by distance (the reference asset leads
 * at distance 0). Shares the AssetListResult shape so the grid renders it
 * exactly like any other list.
 */
export function similarAssetsQueryOptions(id: string) {
	return queryOptions({
		queryKey: assetKeys.similar(id),
		queryFn: async () => {
			const items = unwrap(
				await commands.findSimilarAssets(id, SIMILAR_DISTANCE),
			);
			return { items, total: items.length } satisfies AssetListResult;
		},
	});
}

/**
 * The one list the current view renders — regular scoped list for most
 * views, the ranked dHash neighborhood for view=similar. Grid AND preview
 * both resolve through here so prev/next always walks what the user saw.
 */
export function useLibraryAssetList(
	view: LibraryView,
	sort: SortKey,
	dir: SortDir,
) {
	const similarId = view.view === "similar" ? view.similarTo : undefined;
	const similar = useQuery({
		...similarAssetsQueryOptions(similarId ?? ""),
		enabled: similarId !== undefined,
	});
	const regular = useQuery({
		...assetListQueryOptions({
			scope: scopeFromView(view),
			search: view.q,
			ratingMin: view.rating,
			types: extsForKinds(view.types),
			tags: view.tags,
			sort,
			dir,
		}),
		enabled: similarId === undefined,
	});
	return similarId !== undefined ? similar : regular;
}

// ---------------------------------------------------------------------------
// Mutations. Trash/restore remove ids from every cached list optimistically
// (the acted-on items leave the current view either way); folder membership
// and empty-trash go through plain invalidation.
// ---------------------------------------------------------------------------

type ListSnapshot = Array<
	readonly [readonly unknown[], AssetListResult | undefined]
>;

function snapshotLists(queryClient: QueryClient): ListSnapshot {
	return queryClient.getQueriesData<AssetListResult>({
		queryKey: [...assetKeys.all, "list"],
	});
}

function removeIdsFromLists(
	queryClient: QueryClient,
	ids: ReadonlySet<string>,
): void {
	for (const [key, data] of snapshotLists(queryClient)) {
		if (!data) continue;
		const items = data.items.filter((item) => !ids.has(item.id));
		if (items.length !== data.items.length) {
			queryClient.setQueryData(key as readonly unknown[], {
				items,
				total: Math.max(
					0,
					(data.total ?? items.length) - (data.items.length - items.length),
				),
			});
		}
	}
}

function restoreLists(queryClient: QueryClient, snapshot: ListSnapshot): void {
	for (const [key, data] of snapshot) {
		queryClient.setQueryData(key as readonly unknown[], data);
	}
}

function invalidateAfterAssetMutation(queryClient: QueryClient): void {
	void queryClient.invalidateQueries({ queryKey: assetKeys.all });
	void queryClient.invalidateQueries({ queryKey: folderKeys.all });
	void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
}

function useOptimisticRemoval(mutationFn: (ids: string[]) => Promise<number>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onMutate: async (ids: string[]) => {
			await queryClient.cancelQueries({ queryKey: assetKeys.all });
			const snapshot = snapshotLists(queryClient);
			removeIdsFromLists(queryClient, new Set(ids));
			return { snapshot };
		},
		onError: (error, _ids, context) => {
			if (context) restoreLists(queryClient, context.snapshot);
			toast.error(describeError(error));
		},
		onSettled: () => invalidateAfterAssetMutation(queryClient),
	});
}

export function useTrashAssets() {
	return useOptimisticRemoval(async (ids) =>
		unwrap(await commands.trashAssets(ids)),
	);
}

export function useRestoreAssets() {
	return useOptimisticRemoval(async (ids) =>
		unwrap(await commands.restoreAssets(ids)),
	);
}

export function useDeleteAssetsForever() {
	return useOptimisticRemoval(async (ids) =>
		unwrap(await commands.deleteAssetsForever(ids)),
	);
}

export function useEmptyTrash() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () => unwrap(await commands.emptyTrash()),
		onSuccess: () => invalidateAfterAssetMutation(queryClient),
		onError: (error) => toast.error(describeError(error)),
	});
}

/**
 * Re-extract a video's cover frame (frontend capture → set_video_thumbnail).
 * Used by the video card's context menu to replace a poor/black auto-cover.
 * Bumps the cover-bust token so the immutable-cached thumb reloads.
 */
export function useRegenerateCover() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			const frame = await captureVideoCover(id);
			unwrap(
				await commands.setVideoThumbnail(
					id,
					frame.base64,
					frame.width,
					frame.height,
					frame.durationMs,
				),
			);
			return id;
		},
		onMutate: (id) => {
			toast.loading(T.video.coverUpdating, { id: `cover-${id}` });
		},
		onSuccess: (id) => {
			useCoverBustStore.getState().bump(id);
			void queryClient.invalidateQueries({ queryKey: assetKeys.all });
			void queryClient.invalidateQueries({ queryKey: assetKeys.detail(id) });
			void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
			toast.success(T.video.coverDone, { id: `cover-${id}` });
		},
		onError: (_error, id) => {
			toast.error(T.video.coverFailed, { id: `cover-${id}` });
		},
	});
}

/** Reveal in Finder — fire-and-forget with an error toast. */
export function revealAsset(id: string): void {
	void commands.revealAsset(id).then((result) => {
		if (result.status === "error") toast.error(describeError(result.error));
	});
}

/** Ergonomic partial patch — converted to the wire shape (all-nullable). */
export type AssetPatchInput = {
	name?: string;
	note?: string;
	rating?: number;
	/** Empty string clears the link. */
	url?: string;
};

/**
 * Rename / note / rating updates with optimistic detail + list rewrite.
 * The server returns the authoritative detail on success; lists refetch in
 * the background (a rename can change sort order).
 */
export function useUpdateAsset() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { id: string; patch: AssetPatchInput }) =>
			unwrap(
				await commands.updateAsset(input.id, {
					name: input.patch.name ?? null,
					note: input.patch.note ?? null,
					rating: input.patch.rating ?? null,
					url: input.patch.url ?? null,
				}),
			),
		onMutate: async ({ id, patch }) => {
			await queryClient.cancelQueries({ queryKey: assetKeys.detail(id) });
			const previousDetail = queryClient.getQueryData<AssetDetail>(
				assetKeys.detail(id),
			);
			if (previousDetail) {
				queryClient.setQueryData(assetKeys.detail(id), {
					...previousDetail,
					...(patch.name !== undefined ? { name: patch.name } : {}),
					...(patch.note !== undefined ? { note: patch.note } : {}),
					...(patch.rating !== undefined ? { rating: patch.rating } : {}),
					...(patch.url !== undefined ? { url: patch.url || null } : {}),
				});
			}
			const listSnapshot = snapshotLists(queryClient);
			if (patch.name !== undefined || patch.rating !== undefined) {
				for (const [key, data] of listSnapshot) {
					if (!data) continue;
					let touched = false;
					const items = data.items.map((item) => {
						if (item.id !== id) return item;
						touched = true;
						return {
							...item,
							...(patch.name !== undefined ? { name: patch.name } : {}),
							...(patch.rating !== undefined ? { rating: patch.rating } : {}),
						};
					});
					if (touched) {
						queryClient.setQueryData(key as readonly unknown[], {
							...data,
							items,
						});
					}
				}
			}
			return { previousDetail, listSnapshot };
		},
		onError: (error, { id }, context) => {
			if (context?.previousDetail) {
				queryClient.setQueryData(assetKeys.detail(id), context.previousDetail);
			}
			if (context) restoreLists(queryClient, context.listSnapshot);
			toast.error(describeError(error));
		},
		onSuccess: (detail) => {
			queryClient.setQueryData(assetKeys.detail(detail.id), detail);
		},
		onSettled: () => {
			void queryClient.invalidateQueries({
				queryKey: [...assetKeys.all, "list"],
			});
		},
	});
}
