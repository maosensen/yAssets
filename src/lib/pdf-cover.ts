/**
 * PDF cover capture — renders page 1 with pdf.js (bundled locally, no CDN) to a
 * canvas and returns a base64 JPEG, mirroring lib/video-cover.ts. Used by the
 * background cover worker and the manual "Regenerate Cover" action.
 *
 * pdf.js runs in a same-origin module worker, which CSP `script-src 'self'`
 * permits. The PDF bytes are fetched on the main thread and passed as `data`, so
 * the worker never needs network; `isEvalSupported:false` keeps it within a CSP
 * that has no 'unsafe-eval'. A white `background` fills the page so black text
 * doesn't render on black once flattened into the (opaque) JPEG.
 */

import PdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { CapturedImage } from "@/lib/image-cover";
import { fileUrl } from "@/lib/media";

const TARGET_EDGE = 512;
/** Cap upscaling of tiny (vector) pages so the canvas stays bounded. */
const MAX_SCALE = 4;
const CAPTURE_TIMEOUT_MS = 20_000;

/**
 * pdf.js is heavy (~1MB) and touches DOM globals (DOMMatrix) at module load, so
 * it's imported lazily on first capture — keeping it out of the app-startup
 * bundle and out of the (jsdom) test environment, which lacks those globals.
 */
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
	if (!pdfjsPromise) {
		pdfjsPromise = import("pdfjs-dist").then((lib) => {
			lib.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;
			return lib;
		});
	}
	return pdfjsPromise;
}

export async function capturePdfCover(assetId: string): Promise<CapturedImage> {
	return withTimeout(renderFirstPage(assetId), CAPTURE_TIMEOUT_MS);
}

async function renderFirstPage(assetId: string): Promise<CapturedImage> {
	const pdfjsLib = await loadPdfjs();
	const response = await fetch(fileUrl(assetId));
	if (!response.ok) throw new Error(`pdf fetch failed: ${response.status}`);
	const data = new Uint8Array(await response.arrayBuffer());

	// pdf.js auto-detects that eval is unavailable under the app's CSP (no
	// 'unsafe-eval') and disables its eval-based fast path — no flag needed.
	const loadingTask = pdfjsLib.getDocument({
		data,
		disableAutoFetch: true,
		disableStream: true,
	});
	const doc = await loadingTask.promise;
	try {
		const page = await doc.getPage(1);
		const base = page.getViewport({ scale: 1 });
		const scale = Math.min(
			TARGET_EDGE / Math.max(base.width, base.height),
			MAX_SCALE,
		);
		const viewport = page.getViewport({ scale });

		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.floor(viewport.width));
		canvas.height = Math.max(1, Math.floor(viewport.height));

		await page.render({ canvas, viewport, background: "#ffffff" }).promise;

		const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
		return {
			base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
			width: Math.round(base.width),
			height: Math.round(base.height),
		};
	} finally {
		// Tears down the document, its worker port, and transport.
		void loadingTask.destroy();
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(
			() => reject(new Error("pdf capture timed out")),
			ms,
		);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				window.clearTimeout(timer);
				reject(error);
			},
		);
	});
}
