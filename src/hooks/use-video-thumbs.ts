/**
 * Background video-cover worker (mounted once in AppShell).
 *
 * Videos import without thumbnails — the Rust pipeline only decodes bitmaps
 * and SVG. This worker asks the backend for cover-less videos and captures a
 * frame with the WebView's OWN decoder, so no ffmpeg ships anywhere:
 *
 *   hidden <video crossOrigin="anonymous"> → seek ~1s → draw to a ≤512px
 *   canvas → JPEG base64 → `set_video_thumbnail` (Rust re-encodes WebP and
 *   fills color/dhash/duration).
 *
 * yasset:// answers with `Access-Control-Allow-Origin: *`, which keeps the
 * canvas untainted; if the WebView taints it anyway (SecurityError), one
 * retry goes through a same-origin blob URL (whole-file fetch — acceptable
 * as a fallback). Failing assets land in a session-local skip set so a
 * broken codec never loops.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { commands, events } from "@/lib/bindings";
import { logger } from "@/lib/logger";
import { fileUrl } from "@/lib/media";
import { assetKeys, libraryKeys } from "@/lib/queries/keys";
import { currentLibraryQueryOptions } from "@/lib/queries/library";
import { unwrap } from "@/lib/tauri";

const CAPTURE_TIMEOUT_MS = 20_000;
const TARGET_EDGE = 512;
/** Capture several covers at once so a fresh library fills fast (and one
 *  slow/hung file can't stall the whole queue behind its 20s timeout). */
const CAPTURE_CONCURRENCY = 3;

type Frame = {
	base64: string;
	width: number;
	height: number;
	durationMs: number;
};

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
						const frame = await captureFrame(id);
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

async function captureFrame(assetId: string): Promise<Frame> {
	try {
		return await captureFromSrc(fileUrl(assetId), true);
	} catch (error) {
		// Tainted canvas / CORS quirk → same-origin blob URL retry.
		if (error instanceof Error && error.name === "SecurityError") {
			const response = await fetch(fileUrl(assetId));
			if (!response.ok) throw error;
			const blobUrl = URL.createObjectURL(await response.blob());
			try {
				return await captureFromSrc(blobUrl, false);
			} finally {
				URL.revokeObjectURL(blobUrl);
			}
		}
		throw error;
	}
}

function captureFromSrc(src: string, crossOrigin: boolean): Promise<Frame> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		if (crossOrigin) video.crossOrigin = "anonymous";
		video.muted = true;
		video.playsInline = true;
		video.preload = "auto";

		const timer = window.setTimeout(
			() => fail(new Error("video load timed out")),
			CAPTURE_TIMEOUT_MS,
		);
		const cleanup = () => {
			window.clearTimeout(timer);
			video.removeAttribute("src");
			video.load();
		};
		const fail = (error: unknown) => {
			cleanup();
			reject(error);
		};

		video.onerror = () => fail(new Error("video failed to load/decode"));
		video.onloadedmetadata = () => {
			// Grab a frame past any leading black, but stay inside short clips.
			const duration = Number.isFinite(video.duration) ? video.duration : 0;
			video.currentTime = Math.min(1, duration > 0 ? duration / 10 : 0);
		};
		video.onseeked = () => {
			try {
				const vw = video.videoWidth;
				const vh = video.videoHeight;
				if (!vw || !vh) throw new Error("video reports no dimensions");
				const scale = Math.min(TARGET_EDGE / Math.max(vw, vh), 1);
				const cw = Math.max(1, Math.round(vw * scale));
				const ch = Math.max(1, Math.round(vh * scale));
				const canvas = document.createElement("canvas");
				canvas.width = cw;
				canvas.height = ch;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("2d context unavailable");
				context.drawImage(video, 0, 0, cw, ch);
				// toDataURL throws SecurityError on tainted canvases → fallback.
				const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
				const frame: Frame = {
					base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
					width: vw,
					height: vh,
					durationMs: Number.isFinite(video.duration)
						? video.duration * 1000
						: 0,
				};
				cleanup();
				resolve(frame);
			} catch (error) {
				fail(error);
			}
		};
		video.src = src;
	});
}
