/**
 * Virtualized justified grid for remote (third-party) image results. Reuses the
 * pure `computeJustifiedLayout` over each item's aspect ratio (from the API, no
 * image measurement) — a lightweight parallel to AssetGrid that renders remote
 * thumbnails instead of catalogued assets. Click toggles selection (for batch
 * import); the hover button imports a single item.
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { IconCheck, IconImportImages } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useElementWidth } from "@/hooks/use-element-width";
import type { SourceItem } from "@/lib/bindings";
import { computeJustifiedLayout } from "@/lib/masonry";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

const GAP = 8;
const PADDING = 12;
const LOAD_MORE_ROW_MARGIN = 6;

type RemoteGridProps = {
	items: SourceItem[];
	selectedIds: ReadonlySet<string>;
	onToggleSelect: (id: string) => void;
	onAddOne: (item: SourceItem) => void;
	/** Hex color for Iconify thumbnails (their SVGs use currentColor). */
	iconColor: string;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	onLoadMore: () => void;
};

export function RemoteGrid({
	items,
	selectedIds,
	onToggleSelect,
	onAddOne,
	iconColor,
	hasNextPage,
	isFetchingNextPage,
	onLoadMore,
}: RemoteGridProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const width = useElementWidth(scrollRef);
	const targetRowHeight = useViewPrefsStore((state) => state.targetRowHeight);

	const contentWidth = Math.max(0, width - PADDING * 2);
	const layout = useMemo(
		() =>
			computeJustifiedLayout(
				items.map((item) => ({
					id: item.id,
					ratio: item.width && item.height ? item.width / item.height : 1,
				})),
				{
					containerWidth: contentWidth,
					targetRowHeight,
					gap: GAP,
					captionHeight: 0,
				},
			),
		[items, contentWidth, targetRowHeight],
	);

	const virtualizer = useVirtualizer({
		count: layout.rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: (index) =>
			(layout.rows[index]?.height ?? targetRowHeight) + GAP,
		overscan: 4,
	});

	// Row heights change on resize/zoom/data — refresh the size cache. `layout`
	// is the trigger even though measure() reads none of it directly.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on every relayout.
	useLayoutEffect(() => {
		virtualizer.measure();
	}, [virtualizer, layout]);

	// Fetch the next page as the viewport nears the end.
	const virtualRows = virtualizer.getVirtualItems();
	useEffect(() => {
		const last = virtualRows[virtualRows.length - 1];
		if (
			last &&
			hasNextPage &&
			!isFetchingNextPage &&
			last.index >= layout.rows.length - LOAD_MORE_ROW_MARGIN
		) {
			onLoadMore();
		}
	}, [
		virtualRows,
		layout.rows.length,
		hasNextPage,
		isFetchingNextPage,
		onLoadMore,
	]);

	const itemById = useMemo(
		() => new Map(items.map((item) => [item.id, item])),
		[items],
	);

	return (
		<div
			ref={scrollRef}
			className="min-h-0 flex-1 overflow-y-auto"
			style={{ padding: PADDING }}
		>
			<div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
				{virtualRows.map((virtualRow) => {
					const row = layout.rows[virtualRow.index];
					if (!row) return null;
					return (
						<div
							key={virtualRow.key}
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								height: row.height,
								transform: `translateY(${virtualRow.start}px)`,
							}}
						>
							{row.items.map((cell) => {
								const item = itemById.get(cell.id);
								if (!item) return null;
								return (
									<RemoteCard
										key={item.id}
										item={item}
										left={cell.left}
										width={cell.width}
										height={cell.imageHeight}
										iconColor={iconColor}
										selected={selectedIds.has(item.id)}
										onToggle={() => onToggleSelect(item.id)}
										onAdd={() => onAddOne(item)}
									/>
								);
							})}
						</div>
					);
				})}
			</div>
			{isFetchingNextPage && (
				<div className="py-3 text-center text-muted-foreground text-xs">
					{T.common.loading}
				</div>
			)}
		</div>
	);
}

function RemoteCard({
	item,
	left,
	width,
	height,
	iconColor,
	selected,
	onToggle,
	onAdd,
}: {
	item: SourceItem;
	left: number;
	width: number;
	height: number;
	iconColor: string;
	selected: boolean;
	onToggle: () => void;
	onAdd: () => void;
}) {
	// Iconify thumbnails are SVGs; color them (currentColor → theme neutral) and
	// contain-fit with padding so glyphs sit centered instead of being cropped.
	const isIcon = item.provider === "iconify";
	const src = isIcon
		? `${item.thumb_url}?color=${encodeURIComponent(iconColor)}&height=100`
		: item.thumb_url;
	return (
		<div
			className={cn(
				"group absolute overflow-hidden rounded-md border-2 bg-muted/40",
				selected ? "border-primary" : "border-transparent",
			)}
			style={{ left, width, height }}
		>
			<button
				type="button"
				aria-pressed={selected}
				aria-label={item.source_page_url}
				className="block size-full"
				onClick={onToggle}
			>
				<img
					src={src}
					alt=""
					loading="lazy"
					draggable={false}
					className={cn(
						"size-full",
						isIcon ? "object-contain p-3" : "object-cover",
					)}
				/>
			</button>

			{selected && (
				<div className="pointer-events-none absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
					<IconCheck className="size-3.5" />
				</div>
			)}

			<div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
				<Button
					type="button"
					size="sm"
					className="pointer-events-auto h-7 gap-1 px-2 text-xs"
					onClick={onAdd}
				>
					<IconImportImages className="size-3.5" />
					{T.discover.add}
				</Button>
			</div>
		</div>
	);
}
