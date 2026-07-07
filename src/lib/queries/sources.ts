/**
 * Discover data layer — search third-party image sources (infinite, page-based)
 * and import selected results. The backend owns all network I/O; here we just
 * page results and, on import, invalidate the library views so new assets show.
 */

import {
	infiniteQueryOptions,
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { commands, type SourceFilters, type SourceItem } from "@/lib/bindings";
import { describeError } from "@/lib/errors";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";
import { assetKeys, libraryKeys, sourceKeys } from "./keys";

/** Only provider today. */
const PROVIDER = "wallhaven" as const;

export function sourceSearchQueryOptions(
	query: string,
	filters: SourceFilters,
	apiKey: string | null,
) {
	return infiniteQueryOptions({
		queryKey: sourceKeys.search({
			provider: PROVIDER,
			query,
			filters,
			hasKey: !!apiKey,
		}),
		queryFn: async ({ pageParam }) =>
			unwrap(
				await commands.searchSource(
					PROVIDER,
					query,
					pageParam,
					filters,
					apiKey,
				),
			),
		initialPageParam: 1,
		getNextPageParam: (lastPage) =>
			lastPage.page < lastPage.last_page ? lastPage.page + 1 : undefined,
		// Wallhaven results are stable for a while; don't refetch on every focus.
		staleTime: 5 * 60 * 1000,
	});
}

export function useSourceSearch(
	query: string,
	filters: SourceFilters,
	apiKey: string | null,
) {
	const q = useInfiniteQuery(sourceSearchQueryOptions(query, filters, apiKey));
	// Flatten pages once per data change (a fresh array every render would
	// re-run the grid layout memo).
	const items = useMemo(
		() => q.data?.pages.flatMap((page) => page.items) ?? [],
		[q.data],
	);
	return {
		items,
		isLoading: q.isLoading,
		isError: q.isError,
		error: q.error,
		hasNextPage: q.hasNextPage,
		isFetchingNextPage: q.isFetchingNextPage,
		fetchNextPage: q.fetchNextPage,
	};
}

/** Download + import selected remote items into the library. */
export function useImportSourceItems() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (vars: {
			items: SourceItem[];
			folderId: string | null;
		}) => unwrap(await commands.importSourceItems(vars.items, vars.folderId)),
		onSuccess: (summary) => {
			toast.success(
				T.discover.importDone(
					summary.imported,
					summary.duplicates,
					summary.failed,
				),
			);
			// New assets: refresh every list view + the sidebar counters.
			queryClient.invalidateQueries({ queryKey: assetKeys.all });
			queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
		},
		onError: (error) => toast.error(describeError(error)),
	});
}
