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
import { describeError, isCommandError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assetKeys, folderKeys, libraryKeys } from "@/lib/queries/keys";
import { useDuplicatesStore } from "@/lib/stores/duplicates-store";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";

const PROGRESS_INVALIDATE_MS = 2000;
/** No event for this long ⇒ treat the job's toast as stranded and drop it. */
const STALE_JOB_MS = 60_000;
const STALE_SWEEP_MS = 10_000;

/**
 * Last-seen time per in-flight import job. The progress toast is a `loading`
 * toast (no auto-dismiss) whose only exits are the progress/finished events, so
 * a job that stops reporting — a lost event, a webview reload mid-import —
 * would strand it on screen forever. The sweeper below is that safety net.
 */
const activeJobs = new Map<string, number>();

/** Mark a job alive; called when it starts and on every progress event. */
function touchJob(jobId: string): void {
	activeJobs.set(jobId, Date.now());
}

/** Cancel action offered on the progress toast, so there's always a way out. */
function cancelAction(jobId: string) {
	return {
		label: T.common.cancel,
		onClick: () => {
			void commands.cancelImport(jobId);
		},
	};
}

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
				// Automatic jobs (watched folders) still invalidate — their
				// results matter — but they don't narrate themselves. A watcher
				// re-scanning its root on every launch is not news.
				if (p.origin === "Automatic") {
					throttledInvalidate();
					return;
				}
				touchJob(p.job_id);
				toast.loading(
					p.phase === "Discovering"
						? T.import.discovering(p.total)
						: T.import.progress(p.done, p.total),
					{
						id: p.job_id,
						description: p.current ?? undefined,
						action: cancelAction(p.job_id),
					},
				);
				throttledInvalidate();
			}),
		);
		track(
			events.importFinished.listen((event) => {
				const f = event.payload;
				activeJobs.delete(f.job_id);
				// Library-wide exact duplicates → raise the Duplicate Alert
				// (mounted in AppShell); clean finishes drop the job mapping.
				if (!f.cancelled && f.duplicates.length > 0) {
					useDuplicatesStore.getState().raise(f.job_id, f.duplicates);
				} else {
					useDuplicatesStore.getState().forget(f.job_id);
				}
				// An automatic pass that imported nothing and failed nothing
				// has no news: it is the watched-folder reconciliation finding
				// the folder already catalogued, which used to fire one success
				// toast per watched folder at every launch. Anything it
				// actually did — new files, failures — still surfaces.
				const silent =
					f.origin === "Automatic" &&
					!f.cancelled &&
					f.imported === 0 &&
					f.failed.length === 0;
				if (silent) {
					toast.dismiss(f.job_id);
					invalidateAll();
					return;
				}
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

		// Safety net: drop the toast of any job that went silent (see activeJobs).
		// The import itself may still be running — if it later finishes, its
		// finished event simply shows the usual result toast.
		const sweeper = window.setInterval(() => {
			const now = Date.now();
			for (const [jobId, seen] of activeJobs) {
				if (now - seen < STALE_JOB_MS) continue;
				activeJobs.delete(jobId);
				toast.dismiss(jobId);
				logger.warn({ jobId }, "import job went silent — dismissed its toast");
			}
		}, STALE_SWEEP_MS);

		return () => {
			disposed = true;
			window.clearInterval(sweeper);
			for (const fn of unlistens) fn();
		};
	}, [queryClient]);
}

export function useImport() {
	const mutation = useMutation({
		mutationFn: async (input: {
			paths: string[];
			folderId?: string | null;
			keepDuplicates?: boolean;
		}) =>
			unwrap(
				await commands.importPaths(
					input.paths,
					input.folderId ?? null,
					input.keepDuplicates ?? false,
				),
			),
		onSuccess: (started, input) => {
			// The finish event doesn't echo the folder — remember it for the
			// Duplicate Alert's "keep both" re-import.
			useDuplicatesStore
				.getState()
				.registerJob(started.job_id, input.folderId ?? null);
			touchJob(started.job_id);
			toast.loading(T.import.started, {
				id: started.job_id,
				action: cancelAction(started.job_id),
			});
		},
		onError: (error) => toast.error(describeError(error)),
	});

	return {
		importPaths: (
			paths: string[],
			folderId?: string | null,
			options?: { keepDuplicates?: boolean },
		) => {
			if (paths.length > 0) {
				mutation.mutate({
					paths,
					folderId,
					keepDuplicates: options?.keepDuplicates,
				});
			}
		},
		isImporting: mutation.isPending,
	};
}

/**
 * ⌘V — import copied files or a clipboard bitmap. Progress rides the same
 * import events/toast as any other import; an unusable clipboard (Conflict)
 * is an expected no-op and gets a quiet info toast instead of an error.
 */
export function useImportClipboard() {
	const mutation = useMutation({
		mutationFn: async (folderId: string | null) =>
			unwrap(await commands.importClipboard(folderId)),
		onSuccess: (started, folderId) => {
			useDuplicatesStore.getState().registerJob(started.job_id, folderId);
			touchJob(started.job_id);
			toast.loading(T.import.started, {
				id: started.job_id,
				action: cancelAction(started.job_id),
			});
		},
		onError: (error) => {
			if (isCommandError(error) && error.code === "Conflict") {
				toast.info(T.import.pasteEmpty);
			} else {
				toast.error(describeError(error));
			}
		},
	});

	return {
		importClipboard: (folderId?: string | null) =>
			mutation.mutate(folderId ?? null),
	};
}

/**
 * Paste-a-URL import (⌘V on a clipboard URL). All network is in Rust; this is a
 * single result-returning call (like Discover), so the toast goes
 * loading → result rather than riding the import event stream.
 */
export function useImportUrl() {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async (input: { url: string; folderId: string | null }) =>
			unwrap(await commands.importUrl(input.url, input.folderId)),
		// Fixed id so the loading toast is replaced in place by the result.
		onMutate: () => {
			toast.loading(T.import.urlFetching, { id: URL_TOAST_ID });
		},
		onSuccess: (result) => {
			if (result.duplicate) {
				toast.info(T.import.urlDuplicate, { id: URL_TOAST_ID, duration: 4000 });
			} else if (result.kind === "link") {
				toast.success(T.import.urlSavedLink(result.host), {
					id: URL_TOAST_ID,
					duration: 4000,
				});
			} else {
				toast.success(T.import.urlImportedMedia(result.title), {
					id: URL_TOAST_ID,
					duration: 4000,
				});
			}
			void queryClient.invalidateQueries({ queryKey: assetKeys.all });
			void queryClient.invalidateQueries({ queryKey: folderKeys.all });
			void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
		},
		onError: (error) => toast.error(describeError(error), { id: URL_TOAST_ID }),
	});

	return {
		importUrl: (url: string, folderId?: string | null) =>
			mutation.mutate({ url, folderId: folderId ?? null }),
	};
}

const URL_TOAST_ID = "url-import";
