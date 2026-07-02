/**
 * Double-click full preview: self-drawn fixed overlay (a Dialog would need
 * every default overridden). Thumbnail shows instantly as a stand-in, the
 * original swaps in when decoded; neighbors preload for instant ←/→.
 */

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AssetSummary } from "@/lib/bindings";
import { fileUrl, thumbUrl } from "@/lib/media";
import { T } from "@/lib/text";

type PreviewOverlayProps = {
	assets: readonly AssetSummary[];
	index: number;
	onNavigate: (index: number) => void;
	onClose: () => void;
};

export function PreviewOverlay({
	assets,
	index,
	onNavigate,
	onClose,
}: PreviewOverlayProps) {
	const asset = assets[index];
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [originalSrc, setOriginalSrc] = useState<string | null>(null);

	// Load the original; the (already cached) thumbnail bridges the gap.
	useEffect(() => {
		if (!asset?.has_thumb) {
			setOriginalSrc(null);
			return;
		}
		setOriginalSrc(null);
		const image = new Image();
		image.onload = () => setOriginalSrc(image.src);
		image.src = fileUrl(asset.id);
		return () => {
			image.onload = null;
		};
	}, [asset]);

	// Preload neighbors for instant arrow navigation.
	useEffect(() => {
		for (const neighborIndex of [index - 1, index + 1]) {
			const neighbor = assets[neighborIndex];
			if (neighbor?.has_thumb) {
				new Image().src = fileUrl(neighbor.id);
			}
		}
	}, [index, assets]);

	// Keyboard + initial focus.
	useEffect(() => {
		containerRef.current?.focus();
	}, []);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			} else if (event.key === "ArrowLeft" && index > 0) {
				onNavigate(index - 1);
			} else if (event.key === "ArrowRight" && index < assets.length - 1) {
				onNavigate(index + 1);
			}
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [index, assets.length, onNavigate, onClose]);

	if (!asset) return null;

	return (
		<motion.div
			ref={containerRef}
			role="dialog"
			aria-modal="true"
			aria-label={asset.name}
			tabIndex={-1}
			className="fixed inset-0 z-50 flex flex-col bg-black/90 outline-none"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.15 }}
		>
			<div className="flex items-center justify-end p-2">
				<Button
					variant="ghost"
					size="icon"
					aria-label={T.preview.close}
					className="text-white/80 hover:bg-white/10 hover:text-white"
					onClick={onClose}
				>
					<X className="size-5" />
				</Button>
			</div>

			<div className="relative flex min-h-0 flex-1 items-center justify-center px-14">
				{index > 0 && (
					<Button
						variant="ghost"
						size="icon"
						aria-label={T.preview.prev}
						className="absolute left-2 text-white/80 hover:bg-white/10 hover:text-white"
						onClick={() => onNavigate(index - 1)}
					>
						<ChevronLeft className="size-6" />
					</Button>
				)}

				{asset.has_thumb ? (
					<img
						// Thumbnail bridges until the original decodes.
						src={originalSrc ?? thumbUrl(asset.id)}
						alt={asset.name}
						className="max-h-full max-w-full object-contain"
						draggable={false}
					/>
				) : (
					<div className="flex flex-col items-center gap-3">
						<span className="rounded-lg bg-white/10 px-6 py-4 font-medium text-2xl text-white/80 uppercase">
							{asset.ext || "?"}
						</span>
					</div>
				)}

				{index < assets.length - 1 && (
					<Button
						variant="ghost"
						size="icon"
						aria-label={T.preview.next}
						className="absolute right-2 text-white/80 hover:bg-white/10 hover:text-white"
						onClick={() => onNavigate(index + 1)}
					>
						<ChevronRight className="size-6" />
					</Button>
				)}
			</div>

			<div className="flex items-center justify-center gap-3 p-3 text-sm text-white/80">
				<span className="max-w-md truncate">{asset.name}</span>
				<span className="text-white/50 tabular-nums">
					{T.preview.counter(index + 1, assets.length)}
				</span>
			</div>
		</motion.div>
	);
}
