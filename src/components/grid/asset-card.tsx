/**
 * One grid card: thumbnail (or extension placeholder) + name/meta caption.
 *
 * Memoized with scalar-only props; the selected flag comes from a boolean
 * store selector inside, so selection changes re-render exactly the cards
 * involved. Absolute-positioned by the masonry layout — no DOM measuring.
 */

import { memo, useState } from "react";
import { formatDuration } from "@/lib/format";
import { thumbUrl } from "@/lib/media";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { cn } from "@/lib/utils";
import { iconForExt, VIDEO_EXTS } from "@/lib/viewer-registry";

/** Extensions common enough that a type chip would be visual noise. */
const CHIP_HIDDEN_EXTS = new Set(["png", "jpg", "jpeg"]);

export type SelectModifiers = {
	/** Cmd/Ctrl — toggle membership. */
	toggle: boolean;
	/** Shift — range from the anchor. */
	range: boolean;
};

type AssetCardProps = {
	id: string;
	name: string;
	ext: string;
	hasThumb: boolean;
	/** Source video duration in ms — renders a badge on video cards. */
	durationMs?: number | null;
	/** Layout box width in px (the wrapper positions the card). */
	width: number;
	imageHeight: number;
	captionHeight: number;
	/** Pre-formatted secondary line (dimensions or file size). */
	meta: string;
	onSelect: (id: string, mods: SelectModifiers) => void;
	/** Right-click: keep an existing multi-selection, else select this. */
	onContextSelect: (id: string) => void;
	onOpen: (id: string) => void;
	/** Pointer-drag source handler (in-app drag to folder/trash). */
	onPointerDown: (event: React.PointerEvent) => void;
};

export const AssetCard = memo(function AssetCard({
	id,
	name,
	ext,
	hasThumb,
	durationMs,
	width,
	imageHeight,
	captionHeight,
	meta,
	onSelect,
	onContextSelect,
	onOpen,
	onPointerDown,
}: AssetCardProps) {
	const selected = useSelectionStore((state) => state.selectedIds.has(id));
	const [broken, setBroken] = useState(false);
	const normalizedExt = ext.toLowerCase();
	const showChip = ext !== "" && !CHIP_HIDDEN_EXTS.has(normalizedExt);
	const duration = VIDEO_EXTS.has(normalizedExt)
		? formatDuration(durationMs)
		: null;
	const TypeIcon = iconForExt(ext);

	return (
		<button
			type="button"
			aria-label={name}
			className="flex h-full w-full flex-col text-left outline-none"
			onPointerDown={onPointerDown}
			onClick={(event) =>
				onSelect(id, {
					toggle: event.metaKey || event.ctrlKey,
					range: event.shiftKey,
				})
			}
			onDoubleClick={() => onOpen(id)}
			// Right-click selects too — the context menu acts on the selection.
			onContextMenu={() => onContextSelect(id)}
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
						<TypeIcon className="size-10 text-muted-foreground" />
					</div>
				)}
				{/* File-type chip — every card except the ubiquitous png/jpg. */}
				{showChip && (
					<span className="absolute top-1 left-1 rounded bg-background/80 px-1 py-0.5 font-medium text-[9px] text-foreground uppercase leading-none">
						{ext}
					</span>
				)}
				{/* Duration badge for videos with a probed length. */}
				{duration && (
					<span className="absolute right-1 bottom-1 rounded bg-background/80 px-1 py-0.5 font-medium text-[9px] text-foreground tabular-nums leading-none">
						{duration}
					</span>
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
