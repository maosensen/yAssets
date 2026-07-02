/**
 * Import flows, split in two:
 *
 * - `useImportEvents()` — mount ONCE (AppShell): subscribes the typed
 *   ImportProgress/ImportFinished events, drives the sonner progress toast
 *   (updated in place via `id: job_id`), and handles cache invalidation —
 *   throttled while a job runs (grid fills in progressively), full on finish.
 * - `useImport()` — the mutation half; usable from any component that
 *   triggers imports (drop handler, empty state, toolbar).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { commands, events } from "@/lib/bindings";
import { describeError } from "@/lib/errors";
import { assetKeys, folderKeys, libraryKeys } from "@/lib/queries/keys";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";

const PROGRESS_INVALIDATE_MS = 2000;

export function useImportEvents() {
	const queryClient = useQueryClient();
	const lastInvalidate = useRef(0);

	useEffect(() => {
		let disposed = false;
		const unlistens: Array<() => void> = [];

		const throttledInvalidate = () => {
			const now = Date.now();
			if (now - lastInvalidate.current < PROGRESS_INVALIDATE_MS) return;
			lastInvalidate.current = now;
			void queryClient.invalidateQueries({ queryKey: assetKeys.all });
			void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
		};
		const invalidateAll = () => {
			void queryClient.invalidateQueries({ queryKey: assetKeys.all });
			void queryClient.invalidateQueries({ queryKey: folderKeys.all });
			void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
		};

		const track = (promise: Promise<() => void>) => {
			void promise.then((fn) => {
				if (disposed) fn();
				else unlistens.push(fn);
			});
		};

		track(
			events.importProgress.listen((event) => {
				const p = event.payload;
				toast.loading(
					p.phase === "Discovering"
						? T.import.discovering(p.total)
						: T.import.progress(p.done, p.total),
					{ id: p.job_id, description: p.current ?? undefined },
				);
				throttledInvalidate();
			}),
		);
		track(
			events.importFinished.listen((event) => {
				const f = event.payload;
				if (f.cancelled) {
					toast.info(T.import.cancelled(f.imported), {
						id: f.job_id,
						duration: 4000,
					});
				} else if (f.failed.length > 0) {
					toast.warning(
						T.import.finishedWithFailures(
							f.imported,
							f.skipped,
							f.failed.length,
						),
						{ id: f.job_id, duration: 6000 },
					);
				} else {
					toast.success(T.import.finished(f.imported, f.skipped), {
						id: f.job_id,
						duration: 4000,
					});
				}
				invalidateAll();
			}),
		);

		return () => {
			disposed = true;
			for (const fn of unlistens) fn();
		};
	}, [queryClient]);
}

export function useImport() {
	const mutation = useMutation({
		mutationFn: async (input: { paths: string[]; folderId?: string | null }) =>
			unwrap(await commands.importPaths(input.paths, input.folderId ?? null)),
		onSuccess: (started) =>
			toast.loading(T.import.started, { id: started.job_id }),
		onError: (error) => toast.error(describeError(error)),
	});

	return {
		importPaths: (paths: string[], folderId?: string | null) => {
			if (paths.length > 0) mutation.mutate({ paths, folderId });
		},
		isImporting: mutation.isPending,
	};
}
