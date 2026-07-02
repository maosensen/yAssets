/**
 * Pathless layout for everything that requires an open library.
 *
 * The guard lives here (not in __root) so /welcome stays outside it — no
 * special-casing, no redirect loops. `ensureQueryData` + staleTime:Infinity
 * means day-to-day navigation costs zero IPC; the cache is (re)seeded by the
 * library mutations in `queries/library.ts`.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { commands } from "@/lib/bindings";
import { libraryKeys } from "@/lib/queries/keys";
import { currentLibraryQueryOptions } from "@/lib/queries/library";
import { unwrap } from "@/lib/tauri";

export const Route = createFileRoute("/_library")({
	beforeLoad: async ({ context }) => {
		let library = await context.queryClient.ensureQueryData(
			currentLibraryQueryOptions(),
		);
		if (!library) {
			// Cold start: try the previous session's library before giving up.
			// Race-free by design — the guard blocks navigation until decided,
			// so there is never a flash of the welcome screen on relaunch.
			library = unwrap(await commands.reopenLastLibrary());
			if (library) {
				context.queryClient.setQueryData(libraryKeys.current, library);
			}
		}
		if (!library) {
			throw redirect({ to: "/welcome" });
		}
		return { library };
	},
	component: AppShell,
});
