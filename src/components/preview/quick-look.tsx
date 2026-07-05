/**
 * Quick Look — Finder-style Space preview overlay for image assets. Content
 * follows the grid selection (arrow keys keep working underneath), the
 * original swaps in over the thumbnail once decoded, click/Space/Esc closes.
 * Non-image kinds never land here — Space routes them to the full preview.
 */

import { useEffect, useState } from "react";
import type { AssetSummary } from "@/lib/bindings";
import { fileUrl } from "@/lib/media";
import { useThumbSrc } from "@/lib/stores/cover-bust-store";
import { canDecodeNativeImage } from "@/lib/viewer-registry";

export function QuickLook({
	asset,
	onClose,
}: {
	asset: AssetSummary;
	onClose: () => void;
}) {
	const [originalSrc, setOriginalSrc] = useState<string | null>(null);
	// Cover-bust-aware thumbnail — reflects a regenerated cover (e.g. HEIC).
	const thumbSrc = useThumbSrc(asset.id);

	// Only fetch the original for formats the WebView can decode in an <img>.
	// Thumb-backed formats (tiff/heic/psd/sketch) stay on the 512px thumbnail —
	// the original is either undecodable or needlessly large.
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

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: click-outside dismiss for a keyboard-driven overlay (Space/Esc close it too)
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard equivalents (Space/Esc) live in the route-level handler that owns this overlay
		<div
			className="fixed inset-0 z-[90] flex flex-col bg-black/80 backdrop-blur-sm"
			onClick={onClose}
		>
			<div className="flex h-10 shrink-0 items-center justify-center px-6">
				<span className="max-w-lg truncate text-sm text-white/90">
					{asset.name}
				</span>
			</div>
			<div className="flex min-h-0 flex-1 items-center justify-center p-8 pt-2">
				<img
					src={originalSrc ?? thumbSrc}
					alt={asset.name}
					className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
					draggable={false}
				/>
			</div>
		</div>
	);
}
