/**
 * Library-domain data layer: queryOptions factories + mutation functions +
 * the cache choreography for switching libraries.
 *
 * Components consume these through `useQuery`/`useMutation` (see
 * `hooks/use-library-actions.ts` for the shared open/create/close flows).
 */

import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { commands, type LibraryInfo } from "@/lib/bindings";
import { unwrap } from "@/lib/tauri";
import { libraryKeys } from "./keys";

export function currentLibraryQueryOptions() {
	return queryOptions({
		queryKey: libraryKeys.current,
		queryFn: async () => unwrap(await commands.getCurrentLibrary()),
		// Only our own mutations change the open library, and they write the
		// cache directly — never refetch on a timer.
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function recentLibrariesQueryOptions() {
	return queryOptions({
		queryKey: libraryKeys.recent,
		queryFn: async () => unwrap(await commands.listRecentLibraries()),
		// `missing` liveness is computed server-side at query time; keep this
		// reasonably fresh whenever welcome/switcher mounts.
		staleTime: 10 * 1000,
	});
}

export function libraryStatsQueryOptions() {
	return queryOptions({
		queryKey: libraryKeys.stats,
		queryFn: async () => unwrap(await commands.getLibraryStats()),
	});
}

export async function createLibraryAt(path: string): Promise<LibraryInfo> {
	return unwrap(await commands.createLibrary(path));
}

export async function openLibraryAt(path: string): Promise<LibraryInfo> {
	return unwrap(await commands.openLibrary(path));
}

export async function closeLibrary(): Promise<null> {
	return unwrap(await commands.closeLibrary());
}

export async function removeRecentLibrary(path: string): Promise<null> {
	return unwrap(await commands.removeRecentLibrary(path));
}

/**
 * Cache choreography after a library was opened/created: everything cached
 * belongs to the previous library.
 *
 * NOT `queryClient.clear()`: clearing/removing queries does NOT notify
 * mounted observers — the grid/sidebar would keep rendering the previous
 * library's data (exactly the "switched library, old assets still shown"
 * bug). `resetQueries` resets state AND notifies active observers, flipping
 * them to pending and refetching against the newly opened library.
 * `cancelQueries` first, so an in-flight fetch dispatched against the old
 * library can't land its stale result into the fresh cache.
 */
export async function applyLibrarySwitched(
	queryClient: QueryClient,
	info: LibraryInfo,
): Promise<void> {
	await queryClient.cancelQueries();
	await queryClient.resetQueries();
	// Seed the new library last so the `_library` route guard passes
	// instantly without waiting on a refetch.
	queryClient.setQueryData(libraryKeys.current, info);
}

/**
 * Cache choreography after closing the library (back to welcome). Here
 * `clear()` is fine: navigation to /welcome unmounts every library-scoped
 * observer immediately, and the welcome screen mounts fresh queries.
 */
export async function applyLibraryClosed(
	queryClient: QueryClient,
): Promise<void> {
	await queryClient.cancelQueries();
	queryClient.clear();
	queryClient.setQueryData(libraryKeys.current, null);
}
