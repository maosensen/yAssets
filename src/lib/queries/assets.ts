/**
 * Asset-domain data layer.
 *
 * List strategy: keyset (cursor) pagination via TanStack `useInfiniteQuery`,
 * `PAGE_SIZE` rows per page (see M2 backend `list_assets`). The grid flattens
 * `data.pages`; optimistic mutations walk every page. `total` (grand match
 * count) rides on every page so counters stay accurate independent of how many
 * pages are loaded. The find-similar view is a single capped query normalized
 * into the same flattened shape.
 */

import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import {
	type AssetDetail,
	type AssetListResult,
	type AssetScope,
	type AssetSummary,
	commands,
	type ListCursor,
	type SortDir,
	type SortKey,
} from "@/lib/bindings";
import { captureAndStoreCover } from "@/lib/cover-capture";
import { describeError } from "@/lib/errors";
import { extsForKinds } from "@/lib/file-kinds";
import { type LibraryView, scopeFromView } from "@/lib/library-view";
import { useCoverBustStore } from "@/lib/stores/cover-bust-store";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";
import { assetKeys, folderKeys, libraryKeys } from "./keys";

const PAGE_SIZE = 200;

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

/** The keyset cursor for the page AFTER `item`, per the active sort column.
 *  Numeric sort values are truncated to an integer string (the backend parses
 *  them as i64); `?? 0` guards the `number | null` wire type. */
function cursorFromItem(item: AssetSummary, sort: SortKey): ListCursor {
	const sortValue =
		sort === "Name"
			? item.name
			: sort === "Size"
				? String(Math.trunc(item.size ?? 0))
				: sort === "Rating"
					? String(item.rating)
					: sort === "UpdatedAt"
						? String(Math.trunc(item.updated_at ?? 0))
						: String(Math.trunc(item.imported_at ?? 0));
	return { sort_value: sortValue, id: item.id };
}

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
	return infiniteQueryOptions({
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
		queryFn: async ({ pageParam }) =>
			unwrap(
				await commands.listAssets({
					scope: params.scope,
					search: search ?? null,
					rating_min: ratingMin ?? null,
					types: types ?? null,
					tag_ids: tags ?? null,
					sort: params.sort,
					dir: params.dir,
					cursor: pageParam,
					offset: null,
					limit: PAGE_SIZE,
				}),
			),
		initialPageParam: null as ListCursor | null,
		// A short page means we've reached the end; otherwise the boundary is the
		// last row of the page we just got.
		getNextPageParam: (lastPage) =>
			lastPage.items.length < PAGE_SIZE
				? undefined
				: cursorFromItem(
						lastPage.items[lastPage.items.length - 1],
						params.sort,
					),
	});
}

/**
 * Every asset id matching a view's scope+search+facets, in the active sort order
 * and UNPAGED — backs select-all (Cmd+A) so it covers rows the grid hasn't
 * loaded yet. Facet normalization mirrors `assetListQueryOptions` so the id set
 * matches exactly what the grid shows.
 */
export async function fetchAssetIdsForView(
	view: LibraryView,
	sort: SortKey,
	dir: SortDir,
): Promise<string[]> {
	return unwrap(
		await commands.listAssetIds({
			scope: scopeFromView(view),
			search: view.q?.trim() || null,
			rating_min: view.rating && view.rating > 0 ? view.rating : null,
			types: extsForKinds(view.types) ?? null,
			tag_ids: view.tags && view.tags.length > 0 ? view.tags : null,
			sort,
			dir,
			cursor: null,
			offset: null,
			limit: null,
		}),
	);
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

/** Flattened list surface the grid/preview consume — hides infinite-vs-single. */
export type LibraryAssetList = {
	items: AssetSummary[];
	/** Grand match count (all pages), independent of how many are loaded. */
	total: number;
	isLoading: boolean;
	fetchNextPage: () => void;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
};

/**
 * The one list the current view renders — a keyset-paged infinite query for
 * most views, the single ranked dHash neighborhood for view=similar. Both are
 * flattened to the same shape so the grid AND preview walk what the user saw
 * (prev/next matches the grid the user came from).
 */
export function useLibraryAssetList(
	view: LibraryView,
	sort: SortKey,
	dir: SortDir,
): LibraryAssetList {
	const similarId = view.view === "similar" ? view.similarTo : undefined;
	const similar = useQuery({
		...similarAssetsQueryOptions(similarId ?? ""),
		enabled: similarId !== undefined,
	});
	const regular = useInfiniteQuery({
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

	// Stable identity across renders (only changes when pages change), so the
	// grid's layout/assetById memos don't recompute on every scroll tick.
	const regularItems = useMemo(
		() => regular.data?.pages.flatMap((page) => page.items) ?? [],
		[regular.data],
	);

	if (similarId !== undefined) {
		return {
			items: similar.data?.items ?? [],
			total: similar.data?.total ?? 0,
			isLoading: similar.isLoading,
			fetchNextPage: () => {},
			hasNextPage: false,
			isFetchingNextPage: false,
		};
	}
	return {
		items: regularItems,
		total: regular.data?.pages[0]?.total ?? 0,
		isLoading: regular.isLoading,
		// TanStack's fetchNextPage is stable across renders; a Promise return is
		// assignable to () => void, so pass it straight through (stable identity
		// keeps the grid's fetch-on-scroll effect from re-firing every render).
		fetchNextPage: regular.fetchNextPage,
		hasNextPage: regular.hasNextPage,
		isFetchingNextPage: regular.isFetchingNextPage,
	};
}

// ---------------------------------------------------------------------------
// Mutations. Trash/restore remove ids from every cached list optimistically
// (the acted-on items leave the current view either way); folder membership
// and empty-trash go through plain invalidation.
// ---------------------------------------------------------------------------

/** Cached list value is now an infinite query — pages of AssetListResult. */
type ListData = InfiniteData<AssetListResult, ListCursor | null>;
type ListSnapshot = Array<readonly [readonly unknown[], ListData | undefined]>;

function snapshotLists(queryClient: QueryClient): ListSnapshot {
	return queryClient.getQueriesData<ListData>({
		queryKey: [...assetKeys.all, "list"],
	});
}

function removeIdsFromLists(
	queryClient: QueryClient,
	ids: ReadonlySet<string>,
): void {
	for (const [key, data] of snapshotLists(queryClient)) {
		if (!data) continue;
		let removed = 0;
		const pages = data.pages.map((page) => {
			const items = page.items.filter((item) => !ids.has(item.id));
			removed += page.items.length - items.length;
			return items.length === page.items.length ? page : { ...page, items };
		});
		if (removed > 0) {
			// `total` is the same grand count on every page — keep it in step.
			queryClient.setQueryData<ListData>(key as readonly unknown[], {
				...data,
				pages: pages.map((page) => ({
					...page,
					total: Math.max(0, page.total - removed),
				})),
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
 * Re-generate an asset's cover via the WebView capture pipeline (video frame /
 * PDF page 1 / HEIC image → set_video_thumbnail or set_captured_thumbnail).
 * Used by the card context menu to replace a poor/black auto-cover. Bumps the
 * cover-bust token so the immutable-cached thumb reloads.
 */
export function useRegenerateCover() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { id: string; ext: string }) => {
			await captureAndStoreCover(input.id, input.ext);
			return input.id;
		},
		onMutate: ({ id }) => {
			toast.loading(T.video.coverUpdating, { id: `cover-${id}` });
		},
		onSuccess: (id) => {
			useCoverBustStore.getState().bump(id);
			void queryClient.invalidateQueries({ queryKey: assetKeys.all });
			void queryClient.invalidateQueries({ queryKey: assetKeys.detail(id) });
			void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
			toast.success(T.video.coverDone, { id: `cover-${id}` });
		},
		onError: (_error, { id }) => {
			toast.error(T.video.coverFailed, { id: `cover-${id}` });
		},
	});
}

/**
 * Set an asset's cover from an in-app image (pasted or uploaded) — e.g. a link
 * bookmark that got no auto cover. `dataBase64` is the raw base64 (no data-URL
 * prefix) with its source pixel dimensions; runs through the same capture
 * pipeline as PDF/HEIC covers. Bumps the cover-bust token so the
 * immutable-cached thumb reloads, mirroring `useRegenerateCover`.
 */
export function useSetAssetCover() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: {
			id: string;
			dataBase64: string;
			width: number;
			height: number;
		}) => {
			unwrap(
				await commands.setCapturedThumbnail(
					input.id,
					input.dataBase64,
					input.width,
					input.height,
				),
			);
			return input.id;
		},
		onMutate: ({ id }) => {
			toast.loading(T.cover.setting, { id: `cover-${id}` });
		},
		onSuccess: (id) => {
			useCoverBustStore.getState().bump(id);
			void queryClient.invalidateQueries({ queryKey: assetKeys.all });
			void queryClient.invalidateQueries({ queryKey: assetKeys.detail(id) });
			void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
			toast.success(T.cover.setDone, { id: `cover-${id}` });
		},
		onError: (error, { id }) => {
			toast.error(describeError(error), { id: `cover-${id}` });
		},
	});
}

/** Set the same rating across a multi-selection (batch metadata editing). */
export function useSetAssetsRating() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { assetIds: string[]; rating: number }) =>
			unwrap(await commands.setAssetsRating(input.assetIds, input.rating)),
		onSuccess: () => invalidateAfterAssetMutation(queryClient),
		onError: (error) => toast.error(describeError(error)),
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
					const pages = data.pages.map((page) => {
						let pageTouched = false;
						const items = page.items.map((item) => {
							if (item.id !== id) return item;
							pageTouched = true;
							touched = true;
							return {
								...item,
								...(patch.name !== undefined ? { name: patch.name } : {}),
								...(patch.rating !== undefined ? { rating: patch.rating } : {}),
							};
						});
						return pageTouched ? { ...page, items } : page;
					});
					if (touched) {
						queryClient.setQueryData<ListData>(key as readonly unknown[], {
							...data,
							pages,
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
