/**
 * One grid card: thumbnail (or extension placeholder) + name/meta caption.
 *
 * Memoized with scalar-only props; the selected flag comes from a boolean
 * store selector inside, so selection changes re-render exactly the cards
 * involved. Absolute-positioned by the masonry layout — no DOM measuring.
 */

import { memo, useState } from "react";
import { IconLink } from "@/components/icons";
import { formatDuration, hostLabel } from "@/lib/format";
import { useThumbSrc } from "@/lib/stores/cover-bust-store";
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
	/** `"file"` or `"link"` — a link shows a URL badge + host, opens in browser. */
	kind: string;
	/** Provenance URL — a link card shows its host as the secondary line. */
	url?: string | null;
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
	kind,
	url,
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
	// Cache-busted when this asset's cover is regenerated (see useThumbSrc).
	const thumbSrc = useThumbSrc(id);
	// Track WHICH src failed, so a regenerated cover (new src) auto-retries.
	const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
	const broken = brokenSrc === thumbSrc;
	const normalizedExt = ext.toLowerCase();
	const isLink = kind === "link";
	const host = isLink ? hostLabel(url) : null;
	// Links show a URL badge instead of the (cover's) file-type chip.
	const showChip =
		!isLink && ext !== "" && !CHIP_HIDDEN_EXTS.has(normalizedExt);
	const duration = VIDEO_EXTS.has(normalizedExt)
		? formatDuration(durationMs)
		: null;
	// A link with no usable cover falls back to a link glyph, not a file icon.
	const TypeIcon = isLink ? IconLink : iconForExt(ext);
	// The caption's second line: a link's host, otherwise the passed meta.
	const secondaryLine = host ?? meta;

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
						src={thumbSrc}
						alt=""
						width={Math.round(width)}
						height={Math.round(imageHeight)}
						loading="lazy"
						decoding="async"
						draggable={false}
						className="h-full w-full object-cover"
						onError={() => setBrokenSrc(thumbSrc)}
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
				{/* Link badge — marks a pasted-URL bookmark. */}
				{isLink && (
					<span className="absolute top-1 left-1 flex items-center gap-0.5 rounded bg-background/80 px-1 py-0.5 font-medium text-[9px] text-foreground uppercase leading-none">
						<IconLink className="size-2.5" />
						URL
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
					{secondaryLine}
				</span>
			</span>
		</button>
	);
});
