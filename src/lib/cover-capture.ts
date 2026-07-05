/**
 * Cover-capture dispatch — maps an asset's format to the right WebView-side
 * capture (video frame / PDF page 1 / HEIC image) and persists it through the
 * matching Rust command. The single source of truth shared by the background
 * worker (hooks/use-cover-worker.ts) and the manual "Regenerate Cover" action
 * (queries/assets.ts → useRegenerateCover).
 */

import { commands } from "@/lib/bindings";
import { captureImageCover } from "@/lib/image-cover";
import { capturePdfCover } from "@/lib/pdf-cover";
import { unwrap } from "@/lib/tauri";
import { captureVideoCover } from "@/lib/video-cover";
import { HEIC_EXTS, VIDEO_EXTS } from "@/lib/viewer-registry";

/**
 * Formats whose cover is captured on demand by the WebView (headless Rust can't
 * decode them). Mirrors the SQL in `list_cover_candidates` (commands/assets.rs).
 */
export function hasCapturableCover(ext: string): boolean {
	const e = ext.toLowerCase();
	return VIDEO_EXTS.has(e) || e === "pdf" || HEIC_EXTS.has(e);
}

/** Capture and store a single asset's cover, dispatching by format. */
export async function captureAndStoreCover(
	id: string,
	ext: string,
): Promise<void> {
	const e = ext.toLowerCase();
	if (e === "pdf") {
		const frame = await capturePdfCover(id);
		unwrap(
			await commands.setCapturedThumbnail(
				id,
				frame.base64,
				frame.width,
				frame.height,
			),
		);
	} else if (HEIC_EXTS.has(e)) {
		const frame = await captureImageCover(id);
		unwrap(
			await commands.setCapturedThumbnail(
				id,
				frame.base64,
				frame.width,
				frame.height,
			),
		);
	} else {
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
	}
}
