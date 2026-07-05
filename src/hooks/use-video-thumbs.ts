/**
 * Background video-cover worker (mounted once in AppShell).
 *
 * Videos import without thumbnails — the Rust pipeline only decodes bitmaps
 * and SVG. This worker asks the backend for cover-less videos and captures a
 * frame with the WebView's OWN decoder (no ffmpeg) via `captureVideoCover`
 * (lib/video-cover.ts — samples several positions, keeps the most informative
 * frame), then ships it to `set_video_thumbnail` (Rust re-encodes WebP and
 * fills color/dhash/duration). Failing assets land in a session-local skip set
 * so a broken codec never loops.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { commands, events } from "@/lib/bindings";
import { logger } from "@/lib/logger";
import { assetKeys, libraryKeys } from "@/lib/queries/keys";
import { currentLibraryQueryOptions } from "@/lib/queries/library";
import { unwrap } from "@/lib/tauri";
import { captureVideoCover } from "@/lib/video-cover";

/** Capture several covers at once so a fresh library fills fast (and one
 *  slow/hung file can't stall the whole queue behind its 20s timeout). */
const CAPTURE_CONCURRENCY = 3;

export function useVideoThumbWorker() {
	const queryClient = useQueryClient();
	const { data: library } = useQuery(currentLibraryQueryOptions());
	const failed = useRef<Set<string>>(new Set());
	const running = useRef(false);

	const drain = useCallback(async () => {
		if (running.current) return;
		running.current = true;
		try {
			const ids = unwrap(await commands.listVideoThumbCandidates());
			const queue = ids.filter((id) => !failed.current.has(id));
			let cursor = 0;
			let pendingRefresh = 0;

			const refresh = () => {
				pendingRefresh = 0;
				void queryClient.invalidateQueries({ queryKey: assetKeys.all });
				void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
			};

			// Bounded pool: workers pull from a shared cursor until drained.
			const worker = async () => {
				while (cursor < queue.length) {
					const id = queue[cursor++];
					try {
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
						// Surface covers progressively without spamming refetches.
						if (++pendingRefresh >= CAPTURE_CONCURRENCY) refresh();
					} catch (error) {
						failed.current.add(id);
						logger.warn({ id, error }, "video cover capture failed");
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
			logger.warn({ error }, "video cover queue failed");
		} finally {
			running.current = false;
		}
	}, [queryClient]);

	// Library open/switch → drain; every finished import → drain again.
	useEffect(() => {
		if (library) void drain();
	}, [library, drain]);

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
