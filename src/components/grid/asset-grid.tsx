/**
 * Virtualized justified-rows masonry grid.
 *
 * - Layout is pure math from DB-stored aspect ratios (`lib/masonry.ts`)
 * - Rows are virtualized (`estimateSize` returns exact heights)
 * - Zoom / panel-resize keep the first visible row anchored
 * - The scroll container is a plain overflow element (virtualizer needs it)
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { AssetCard } from "@/components/grid/asset-card";
import { AssetContextItems } from "@/components/grid/asset-context-items";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useElementWidth } from "@/hooks/use-element-width";
import type { AssetSummary } from "@/lib/bindings";
import { formatBytes, formatDimensions } from "@/lib/format";
import { computeJustifiedLayout } from "@/lib/masonry";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";

const GAP = 8;
const CAPTION_HEIGHT = 36;
const PADDING = 12;

type AssetGridProps = {
	assets: AssetSummary[];
	onOpen: (id: string) => void;
	/** True when the grid shows the trash view (menu switches to restore). */
	inTrash: boolean;
	/** Set when the grid shows a folder view (enables remove-from-folder). */
	currentFolderId: string | null;
	onRequestDeleteForever: (id: string) => void;
};

export function AssetGrid({
	assets,
	onOpen,
	inTrash,
	currentFolderId,
	onRequestDeleteForever,
}: AssetGridProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const width = useElementWidth(scrollRef);
	const targetRowHeight = useViewPrefsStore((state) => state.targetRowHeight);
	const selectOnly = useSelectionStore((state) => state.selectOnly);

	const contentWidth = Math.max(0, width - PADDING * 2);
	const layout = useMemo(
		() =>
			computeJustifiedLayout(
				assets.map((asset) => ({
					id: asset.id,
					ratio: asset.width && asset.height ? asset.width / asset.height : 1,
				})),
				{
					containerWidth: contentWidth,
					targetRowHeight,
					gap: GAP,
					captionHeight: CAPTION_HEIGHT,
				},
			),
		[assets, contentWidth, targetRowHeight],
	);

	const virtualizer = useVirtualizer({
		count: layout.rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: (index) =>
			(layout.rows[index]?.height ?? targetRowHeight + CAPTION_HEIGHT) + GAP,
		overscan: 4,
	});

	// On any relayout (zoom / resize / data): refresh the virtualizer's size
	// cache and keep the previously visible row anchored under the viewport.
	const layoutRef = useRef(layout);
	useLayoutEffect(() => {
		const previous = layoutRef.current;
		layoutRef.current = layout;
		virtualizer.measure();
		if (
			previous === layout ||
			previous.rows.length === 0 ||
			layout.rows.length === 0
		) {
			return;
		}
		const element = scrollRef.current;
		if (!element || element.scrollTop <= 0) return;

		const top = element.scrollTop;
		const anchorRow = previous.rows.find((row) => row.top + row.height > top);
		const anchorId = anchorRow?.items[0]?.id;
		if (!anchorId) return;
		const newIndex = layout.rowIndexOf.get(anchorId);
		if (newIndex === undefined) return;
		const newTop = layout.rows[newIndex]?.top ?? 0;
		if (Math.abs(newTop - top) > 4) {
			virtualizer.scrollToOffset(newTop);
		}
	}, [layout, virtualizer]);

	const assetById = useMemo(
		() => new Map(assets.map((asset) => [asset.id, asset])),
		[assets],
	);
	const handleSelect = useCallback(
		(id: string) => selectOnly(id),
		[selectOnly],
	);

	return (
		<div
			ref={scrollRef}
			className="h-full overflow-y-auto"
			style={{ padding: PADDING }}
		>
			<div
				className="relative"
				style={{ height: layout.totalHeight, width: contentWidth }}
			>
				{virtualizer.getVirtualItems().map((virtualRow) => {
					const row = layout.rows[virtualRow.index];
					if (!row) return null;
					return (
						<div
							key={virtualRow.key}
							className="absolute top-0 left-0 w-full"
							style={{
								height: row.height,
								transform: `translateY(${row.top}px)`,
							}}
						>
							{row.items.map((item) => {
								const asset = assetById.get(item.id);
								if (!asset) return null;
								return (
									<ContextMenu key={item.id}>
										<ContextMenuTrigger
											className="absolute top-0"
											style={{
												left: item.left,
												width: item.width,
												height: item.imageHeight + CAPTION_HEIGHT,
											}}
										>
											<AssetCard
												id={item.id}
												name={asset.name}
												ext={asset.ext}
												hasThumb={asset.has_thumb}
												width={item.width}
												imageHeight={item.imageHeight}
												captionHeight={CAPTION_HEIGHT}
												meta={
													formatDimensions(asset.width, asset.height) ??
													formatBytes(asset.size ?? 0)
												}
												onSelect={handleSelect}
												onOpen={onOpen}
											/>
										</ContextMenuTrigger>
										<ContextMenuContent>
											<AssetContextItems
												assetId={item.id}
												inTrash={inTrash}
												currentFolderId={currentFolderId}
												onRequestDeleteForever={onRequestDeleteForever}
											/>
										</ContextMenuContent>
									</ContextMenu>
								);
							})}
						</div>
					);
				})}
			</div>
		</div>
	);
}
