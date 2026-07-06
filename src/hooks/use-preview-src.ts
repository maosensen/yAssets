/**
 * The best <img> src for previewing an asset: the cover-bust-aware thumbnail
 * immediately, swapped to the full-resolution original once it decodes — but
 * only for formats the WebView can decode in an <img> (tiff/heic/psd/sketch
 * stay on the thumbnail; their original is undecodable or needlessly large).
 *
 * Shared by the preview canvas (ImageBody), Quick Look, and Compare panels so
 * the thumb→original bridge behaves identically everywhere.
 */

import { useEffect, useState } from "react";
import type { AssetSummary } from "@/lib/bindings";
import { fileUrl } from "@/lib/media";
import { useThumbSrc } from "@/lib/stores/cover-bust-store";
import { canDecodeNativeImage } from "@/lib/viewer-registry";

export function usePreviewSrc(asset: Pick<AssetSummary, "id" | "ext">): string {
	const thumbSrc = useThumbSrc(asset.id);
	const [originalSrc, setOriginalSrc] = useState<string | null>(null);

	useEffect(() => {
		setOriginalSrc(null);
		if (!canDecodeNativeImage(asset.ext)) return;
		const image = new Image();
		image.onload = () => setOriginalSrc(image.src);
		image.src = fileUrl(asset.id);
		return () => {
			image.onload = null;
		};
	}, [asset.id, asset.ext]);

	return originalSrc ?? thumbSrc;
}
