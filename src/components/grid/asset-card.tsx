/**
 * One grid card: thumbnail (or extension placeholder) + name/meta caption.
 *
 * Memoized with scalar-only props; the selected flag comes from a boolean
 * store selector inside, so selection changes re-render exactly the cards
 * involved. Absolute-positioned by the masonry layout — no DOM measuring.
 */

import { memo, useState } from "react";
import { thumbUrl } from "@/lib/media";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { cn } from "@/lib/utils";

type AssetCardProps = {
	id: string;
	name: string;
	ext: string;
	hasThumb: boolean;
	/** Layout box width in px (the wrapper positions the card). */
	width: number;
	imageHeight: number;
	captionHeight: number;
	/** Pre-formatted secondary line (dimensions or file size). */
	meta: string;
	onSelect: (id: string) => void;
	onOpen: (id: string) => void;
};

export const AssetCard = memo(function AssetCard({
	id,
	name,
	ext,
	hasThumb,
	width,
	imageHeight,
	captionHeight,
	meta,
	onSelect,
	onOpen,
}: AssetCardProps) {
	const selected = useSelectionStore((state) => state.selectedIds.has(id));
	const [broken, setBroken] = useState(false);

	return (
		<button
			type="button"
			aria-label={name}
			className="flex h-full w-full flex-col text-left outline-none"
			onClick={() => onSelect(id)}
			onDoubleClick={() => onOpen(id)}
			// Right-click also selects — the context menu acts on this card.
			onContextMenu={() => onSelect(id)}
		>
			<div
				className={cn(
					"relative w-full overflow-hidden rounded-md bg-muted",
					selected && "ring-2 ring-primary",
				)}
				style={{ height: imageHeight, contain: "strict" }}
			>
				{hasThumb && !broken ? (
					<img
						src={thumbUrl(id)}
						alt=""
						width={Math.round(width)}
						height={Math.round(imageHeight)}
						loading="lazy"
						decoding="async"
						draggable={false}
						className="h-full w-full object-cover"
						onError={() => setBroken(true)}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center">
						<span className="rounded bg-background/70 px-2 py-1 font-medium text-muted-foreground text-xs uppercase">
							{ext || "?"}
						</span>
					</div>
				)}
			</div>
			<span
				className="flex w-full flex-col justify-center px-0.5"
				style={{ height: captionHeight }}
			>
				<span className="truncate text-xs">{name}</span>
				<span className="truncate text-[10px] text-muted-foreground">
					{meta}
				</span>
			</span>
		</button>
	);
});
