/**
 * Side-by-side compare — 2-4 assets in independent pan/zoom panels, for eyeing
 * variants / near-duplicates. Launched from the grid context menu on a 2-4
 * selection. Esc or the close button dismisses. Each panel is its own
 * CanvasViewer, so zoom/pan is per-panel (synced zoom is a future enhancement).
 */

import { useEffect } from "react";
import { IconClose } from "@/components/icons";
import { CanvasViewer } from "@/components/preview/canvas-viewer";
import { Button } from "@/components/ui/button";
import { usePreviewSrc } from "@/hooks/use-preview-src";
import type { AssetSummary } from "@/lib/bindings";
import { T } from "@/lib/text";

export function Compare({
	assets,
	onClose,
}: {
	assets: AssetSummary[];
	onClose: () => void;
}) {
	// Capture-phase + stopPropagation so the grid's window shortcuts (Space →
	// Quick Look, arrows, Enter, tag keys) can't fire behind the overlay. Esc
	// closes; every other key is simply swallowed while compare is open.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			event.stopPropagation();
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	return (
		<div className="fixed inset-0 z-[90] flex flex-col bg-background">
			<header className="flex h-12 shrink-0 items-center justify-between border-b px-3">
				<span className="font-medium text-sm">
					{T.compare.title(assets.length)}
				</span>
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={T.compare.close}
					title={T.compare.close}
					onClick={onClose}
				>
					<IconClose className="size-4" />
				</Button>
			</header>
			<div className="flex min-h-0 flex-1">
				{assets.map((asset) => (
					<ComparePanel key={asset.id} asset={asset} />
				))}
			</div>
		</div>
	);
}

function ComparePanel({ asset }: { asset: AssetSummary }) {
	const src = usePreviewSrc(asset);
	const hasDims = asset.width != null && asset.height != null;

	return (
		<div className="flex min-w-0 flex-1 flex-col border-border/60 border-r last:border-r-0">
			<div className="flex shrink-0 items-baseline justify-between gap-2 border-b bg-muted/30 px-3 py-1.5">
				<span className="min-w-0 truncate text-xs" title={asset.name}>
					{asset.name}
				</span>
				{hasDims && (
					<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
						{asset.width}×{asset.height}
					</span>
				)}
			</div>
			<div className="min-h-0 flex-1">
				{hasDims && asset.width != null && asset.height != null ? (
					<CanvasViewer
						src={src}
						alt={asset.name}
						imageWidth={asset.width}
						imageHeight={asset.height}
					/>
				) : (
					<div className="flex h-full items-center justify-center">
						<span className="rounded-md bg-muted px-4 py-2 font-medium text-muted-foreground text-xl uppercase">
							{asset.ext || "?"}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
