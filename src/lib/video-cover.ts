/**
 * Video cover extraction — the frame-grab used by the background cover worker
 * (use-cover-worker.ts, via lib/cover-capture.ts) and the manual
 * "Regenerate Cover" action.
 *
 * A single seek near t=1s often lands on a black intro / fade-in, so we sample
 * several positions and keep the most INFORMATIVE frame (highest luminance
 * variance — black/solid frames score ~0). Each frame is drawn only after it's
 * actually painted (`requestVideoFrameCallback`, falling back to a short timer)
 * so we never capture a not-yet-decoded black frame.
 *
 * Decode is the WebView's own — no ffmpeg. yasset:// answers with
 * `Access-Control-Allow-Origin: *`, keeping the canvas untainted; if the engine
 * taints it anyway (SecurityError from getImageData/toDataURL), one retry goes
 * through a same-origin blob URL.
 */

import { fileUrl } from "@/lib/media";

const CAPTURE_TIMEOUT_MS = 20_000;
const TARGET_EDGE = 512;
/** Where to sample, as fractions of duration — spread past a black intro. */
const SAMPLE_FRACTIONS = [0.1, 0.25, 0.5, 0.75];
/** Luminance variance above which a frame is "clearly content" (early-exit). */
const GOOD_ENOUGH_SCORE = 800;
/** Frame-paint fallback when requestVideoFrameCallback doesn't deliver. */
const FRAME_FALLBACK_MS = 250;
/** Give up waiting for a "seeked" event (empty seekable / duration-less). */
const SEEK_SETTLE_MS = 4000;
/** Fixed sample offsets (s) when duration is unknown (streamed/fragmented). */
const FALLBACK_TIMES = [0, 1, 3];

const delay = (ms: number) =>
	new Promise<void>((res) => {
		window.setTimeout(res, ms);
	});

export type CapturedFrame = {
	base64: string;
	width: number;
	height: number;
	durationMs: number;
};

type VideoWithVFC = HTMLVideoElement & {
	requestVideoFrameCallback?: (cb: () => void) => number;
};

/**
 * Mean luminance variance over the pixels (Rec. 601). Pure + exported for
 * tests: a flat/black frame → ~0, a detailed frame → high. Strided so large
 * frames stay cheap (~4k samples).
 */
export function luminanceVariance(data: Uint8ClampedArray): number {
	const pixels = Math.floor(data.length / 4);
	if (pixels === 0) return 0;
	const stride = Math.max(1, Math.floor(pixels / 4096)) * 4;
	let sum = 0;
	let sumSq = 0;
	let n = 0;
	for (let i = 0; i + 2 < data.length; i += stride) {
		const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
		sum += lum;
		sumSq += lum * lum;
		n += 1;
	}
	if (n === 0) return 0;
	const mean = sum / n;
	return Math.max(0, sumSq / n - mean * mean);
}

/** Capture the best cover frame for an asset, with a blob-URL CORS fallback. */
export async function captureVideoCover(
	assetId: string,
): Promise<CapturedFrame> {
	const url = fileUrl(assetId);
	try {
		return await capture(url, true);
	} catch (error) {
		if (error instanceof Error && error.name === "SecurityError") {
			const response = await fetch(url);
			if (!response.ok) throw error;
			const blobUrl = URL.createObjectURL(await response.blob());
			try {
				return await capture(blobUrl, false);
			} finally {
				URL.revokeObjectURL(blobUrl);
			}
		}
		throw error;
	}
}

function capture(src: string, crossOrigin: boolean): Promise<CapturedFrame> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video") as VideoWithVFC;
		if (crossOrigin) video.crossOrigin = "anonymous";
		video.muted = true;
		video.playsInline = true;
		video.preload = "auto";

		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d", { willReadFrequently: true });

		let settled = false;
		const timer = window.setTimeout(
			() => finish(new Error("video capture timed out")),
			CAPTURE_TIMEOUT_MS,
		);
		const cleanup = () => {
			window.clearTimeout(timer);
			video.removeAttribute("src");
			video.load();
		};
		const finish = (error: unknown, frame?: CapturedFrame) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (frame) resolve(frame);
			else reject(error);
		};

		video.onerror = () => finish(new Error("video failed to load/decode"));

		const once = (event: string) =>
			new Promise<void>((res) => {
				const handler = () => {
					video.removeEventListener(event, handler);
					res();
				};
				video.addEventListener(event, handler);
			});

		// Resolve once the seeked frame is actually painted.
		const frameReady = () =>
			new Promise<void>((res) => {
				let done = false;
				const go = () => {
					if (done) return;
					done = true;
					res();
				};
				video.requestVideoFrameCallback?.(go);
				window.setTimeout(go, FRAME_FALLBACK_MS);
			});

		void (async () => {
			try {
				await once("loadedmetadata");
				if (settled) return;
				const duration =
					Number.isFinite(video.duration) && video.duration > 0
						? video.duration
						: 0;
				const times =
					duration > 0
						? SAMPLE_FRACTIONS.map((f) => f * duration)
						: FALLBACK_TIMES;

				let best: {
					score: number;
					base64: string;
					w: number;
					h: number;
				} | null = null;
				for (const time of times) {
					if (settled) return;
					// Skip a no-op seek (target already current) — it fires no
					// "seeked" and would hang; and race "seeked" against a timer so
					// a source with an empty seekable range (duration-less WebM)
					// can't stall the whole capture for 20s.
					if (Math.abs(video.currentTime - time) > 1e-3) {
						const seeked = once("seeked");
						video.currentTime = time;
						await Promise.race([seeked, delay(SEEK_SETTLE_MS)]);
						if (settled) return;
					}
					await frameReady();
					if (settled) return;

					if (!ctx) throw new Error("2d context unavailable");
					const vw = video.videoWidth;
					const vh = video.videoHeight;
					if (!vw || !vh) throw new Error("video reports no dimensions");
					const scale = Math.min(TARGET_EDGE / Math.max(vw, vh), 1);
					const cw = Math.max(1, Math.round(vw * scale));
					const ch = Math.max(1, Math.round(vh * scale));
					canvas.width = cw;
					canvas.height = ch;
					ctx.drawImage(video, 0, 0, cw, ch);
					// getImageData throws SecurityError on a tainted canvas → fallback.
					const score = luminanceVariance(ctx.getImageData(0, 0, cw, ch).data);
					if (!best || score > best.score) {
						const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
						best = {
							score,
							base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
							w: vw,
							h: vh,
						};
					}
					if (score >= GOOD_ENOUGH_SCORE) break;
				}

				if (!best) throw new Error("no frame captured");
				finish(null, {
					base64: best.base64,
					width: best.w,
					height: best.h,
					durationMs: Number.isFinite(video.duration)
						? video.duration * 1000
						: 0,
				});
			} catch (error) {
				finish(error);
			}
		})();

		video.src = src;
	});
}
