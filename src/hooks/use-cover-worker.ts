/**
 * Background cover worker (mounted once in AppShell).
 *
 * Two tiers fill thumbnails the import pipeline couldn't:
 *  1. Server backfill — Rust re-thumbnails formats it can now decode headless
 *     (TIFF/ICO/PSD/Sketch that predate support), via `backfillMissingThumbnails`.
 *  2. Client capture — formats only the WebView can decode: video frames, PDF
 *     page 1 (pdf.js), and HEIC/HEIF images. Captured frames ship back to Rust
 *     for WebP re-encode (see lib/cover-capture.ts for the dispatch).
 *
 * Failing assets land in a session-local skip set so a broken file never loops.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { commands, events } from "@/lib/bindings";
import { captureAndStoreCover } from "@/lib/cover-capture";
import { logger } from "@/lib/logger";
import { assetKeys, libraryKeys } from "@/lib/queries/keys";
import { currentLibraryQueryOptions } from "@/lib/queries/library";
import { unwrap } from "@/lib/tauri";

/** Capture several covers at once so a fresh library fills fast (and one
 *  slow/hung file can't stall the whole queue behind its capture timeout). */
const CAPTURE_CONCURRENCY = 3;

export function useCoverWorker() {
	const queryClient = useQueryClient();
	const { data: library } = useQuery(currentLibraryQueryOptions());
	const failed = useRef<Set<string>>(new Set());
	const backfilled = useRef<Set<string>>(new Set());
	const running = useRef(false);

	const drain = useCallback(
		async (backfillLibraryId?: string) => {
			if (running.current) return;
			running.current = true;
			try {
				const refresh = () => {
					void queryClient.invalidateQueries({ queryKey: assetKeys.all });
					void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
				};

				// 1) Server-side backfill — ONCE per library per session. New
				// imports thumbnail headless-decodable formats inline, so this only
				// catches up files that predate support; re-running it every import
				// would just re-decode permanently-failing files (no skip marker
				// exists server-side). A transient failure un-marks so a later open
				// retries.
				if (backfillLibraryId && !backfilled.current.has(backfillLibraryId)) {
					backfilled.current.add(backfillLibraryId);
					try {
						const filled = unwrap(await commands.backfillMissingThumbnails());
						if (filled > 0) refresh();
					} catch (error) {
						backfilled.current.delete(backfillLibraryId);
						logger.warn({ error }, "thumbnail backfill failed");
					}
				}

				// 2) Client capture for WebView-only formats (video/PDF/HEIC).
				const candidates = unwrap(await commands.listCoverCandidates());
				const queue = candidates.filter((c) => !failed.current.has(c.id));
				let cursor = 0;
				let pendingRefresh = 0;

				// Bounded pool: workers pull from a shared cursor until drained.
				const worker = async () => {
					while (cursor < queue.length) {
						const candidate = queue[cursor++];
						try {
							await captureAndStoreCover(candidate.id, candidate.ext);
							// Surface covers progressively without spamming refetches.
							if (++pendingRefresh >= CAPTURE_CONCURRENCY) {
								pendingRefresh = 0;
								refresh();
							}
						} catch (error) {
							failed.current.add(candidate.id);
							logger.warn(
								{ id: candidate.id, ext: candidate.ext, error },
								"cover capture failed",
							);
						}
					}
				};

				await Promise.all(
					Array.from(
						{ length: Math.min(CAPTURE_CONCURRENCY, queue.length) },
						() => worker(),
					),
				);
				if (pendingRefresh > 0) refresh();
			} catch (error) {
				logger.warn({ error }, "cover queue failed");
			} finally {
				running.current = false;
			}
		},
		[queryClient],
	);

	// Library open/switch → drain WITH backfill (once per library this session).
	useEffect(() => {
		if (library) void drain(library.library_id);
	}, [library, drain]);

	// Finished import → client capture only (new server-format thumbs are made
	// inline at import; no backfill id → backfill is skipped).
	useEffect(() => {
		let disposed = false;
		let unlisten: (() => void) | undefined;
		void events.importFinished
			.listen(() => {
				void drain();
			})
			.then((fn) => {
				if (disposed) fn();
				else unlisten = fn;
			});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [drain]);
}
