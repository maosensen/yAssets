/**
 * Image cover capture for formats the WebView decodes but headless Rust can't
 * (HEIC/HEIF — WebKit on macOS decodes them; Chromium WebView2 / WebKitGTK do
 * not). Draws the decoded <img> to a canvas and returns a base64 JPEG, mirroring
 * lib/video-cover.ts. On engines that can't decode the format the <img> errors
 * and this rejects — the cover worker then skips it, leaving the type icon.
 *
 * yasset:// answers with `Access-Control-Allow-Origin: *`, so the canvas stays
 * untainted; if the engine taints it anyway (SecurityError from toDataURL), one
 * retry goes through a same-origin blob URL.
 */

import { fileUrl } from "@/lib/media";

const TARGET_EDGE = 512;
const CAPTURE_TIMEOUT_MS = 15_000;

export type CapturedImage = {
	base64: string;
	width: number;
	height: number;
};

/** Capture a cover for a WebView-decodable image, with a blob-URL CORS fallback. */
export async function captureImageCover(
	assetId: string,
): Promise<CapturedImage> {
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

function capture(src: string, crossOrigin: boolean): Promise<CapturedImage> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		if (crossOrigin) img.crossOrigin = "anonymous";

		const timer = window.setTimeout(() => {
			cleanup();
			reject(new Error("image capture timed out"));
		}, CAPTURE_TIMEOUT_MS);
		const cleanup = () => {
			window.clearTimeout(timer);
			img.onload = null;
			img.onerror = null;
		};

		img.onerror = () => {
			cleanup();
			reject(new Error("image failed to decode"));
		};
		img.onload = () => {
			try {
				const vw = img.naturalWidth;
				const vh = img.naturalHeight;
				if (!vw || !vh) throw new Error("image reports no dimensions");
				const scale = Math.min(TARGET_EDGE / Math.max(vw, vh), 1);
				const cw = Math.max(1, Math.round(vw * scale));
				const ch = Math.max(1, Math.round(vh * scale));
				const canvas = document.createElement("canvas");
				canvas.width = cw;
				canvas.height = ch;
				const ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("2d context unavailable");
				ctx.drawImage(img, 0, 0, cw, ch);
				// toDataURL throws SecurityError on a tainted canvas → blob fallback.
				const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
				cleanup();
				resolve({
					base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
					width: vw,
					height: vh,
				});
			} catch (error) {
				cleanup();
				reject(error);
			}
		};

		img.src = src;
	});
}
