/**
 * Virtualized justified-rows masonry grid.
 *
 * - Layout is pure math from DB-stored aspect ratios (`lib/masonry.ts`)
 * - Rows are virtualized (`estimateSize` returns exact heights)
 * - Zoom / panel-resize keep the first visible row anchored
 * - The scroll container is a plain overflow element (virtualizer needs it)
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { FolderPicker } from "@/components/folder-picker";
import { AssetCard, type SelectModifiers } from "@/components/grid/asset-card";
import { AssetContextItems } from "@/components/grid/asset-context-items";
import { Compare } from "@/components/preview/compare";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useCardDrag } from "@/hooks/use-card-drag";
import { useElementWidth } from "@/hooks/use-element-width";
import type { AssetSummary } from "@/lib/bindings";
import { formatBytes, formatDimensions } from "@/lib/format";
import { computeJustifiedLayout, itemsInRect, type Rect } from "@/lib/masonry";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";

const GAP = 8;
const CAPTION_HEIGHT = 36;
const PADDING = 12;
/** Pointer must travel this far before a blank-drag becomes a marquee. */
const MARQUEE_THRESHOLD = 4;

type AssetGridProps = {
	assets: AssetSummary[];
	onOpen: (id: string) => void;
	/** True when the grid shows the trash view (menu switches to restore). */
	inTrash: boolean;
	/** Set when the grid shows a folder view (enables remove-from-folder). */
	currentFolderId: string | null;
	onRequestDeleteForever: (ids: string[]) => void;
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
	// Folder picker opens from the context menu (which unmounts on select), so
	// its target ids are held here and the dialog lives at the grid root.
	const [pickerIds, setPickerIds] = useState<string[] | null>(null);
	// Compare overlay opens from the context menu (which unmounts on select), so
	// its target ids are held here and the overlay lives at the grid root.
	const [compareIds, setCompareIds] = useState<string[] | null>(null);
	// Resolve to live assets so a list refetch/trash under the overlay can't
	// leave it showing a degenerate 0-1 panel view (guard on THIS length).
	const compareAssets =
		compareIds !== null
			? assets.filter((asset) => compareIds.includes(asset.id))
			: [];
	const targetRowHeight = useViewPrefsStore((state) => state.targetRowHeight);
	const selectOnly = useSelectionStore((state) => state.selectOnly);
	const cardDrag = useCardDrag();

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
	const orderedIds = useMemo(() => assets.map((asset) => asset.id), [assets]);

	// Arrow-key navigation over the layout geometry: ←/→ walk reading order,
	// ↑/↓ jump to the nearest-x card in the adjacent masonry row.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
			) {
				return;
			}
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable ||
					target.closest('[role="dialog"]'))
			) {
				return;
			}
			if (orderedIds.length === 0) return;
			event.preventDefault();

			const store = useSelectionStore.getState();
			const current = store.anchorId;
			let nextId: string | undefined;
			if (!current || !layout.rowIndexOf.has(current)) {
				nextId = orderedIds[0];
			} else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				const index = orderedIds.indexOf(current);
				const step = event.key === "ArrowLeft" ? -1 : 1;
				nextId =
					orderedIds[
						Math.min(orderedIds.length - 1, Math.max(0, index + step))
					];
			} else {
				const rowIndex = layout.rowIndexOf.get(current);
				if (rowIndex === undefined) return;
				const targetRow =
					layout.rows[rowIndex + (event.key === "ArrowUp" ? -1 : 1)];
				if (!targetRow) return; // top/bottom edge — stay put
				const currentItem = layout.rows[rowIndex]?.items.find(
					(item) => item.id === current,
				);
				const centerX = currentItem
					? currentItem.left + currentItem.width / 2
					: 0;
				let best = targetRow.items[0];
				let bestDistance = Number.POSITIVE_INFINITY;
				for (const item of targetRow.items) {
					const distance = Math.abs(item.left + item.width / 2 - centerX);
					if (distance < bestDistance) {
						bestDistance = distance;
						best = item;
					}
				}
				nextId = best?.id;
			}

			if (!nextId) return;
			store.selectOnly(nextId);
			const rowIndex = layout.rowIndexOf.get(nextId);
			if (rowIndex !== undefined) {
				virtualizer.scrollToIndex(rowIndex, { align: "auto" });
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [layout, orderedIds, virtualizer]);

	// Click: plain = select-only · Cmd/Ctrl = toggle · Shift = anchor range.
	const handleSelect = useCallback(
		(id: string, mods: SelectModifiers) => {
			// A drag just ended — swallow the trailing click so it doesn't
			// collapse the selection we just dragged.
			if (cardDrag.draggedRef.current) return;
			const store = useSelectionStore.getState();
			if (mods.range && store.anchorId) {
				const from = orderedIds.indexOf(store.anchorId);
				const to = orderedIds.indexOf(id);
				if (from >= 0 && to >= 0) {
					const [start, end] = from <= to ? [from, to] : [to, from];
					store.selectMany(orderedIds.slice(start, end + 1), store.anchorId);
					return;
				}
			}
			if (mods.toggle) {
				store.toggle(id);
				return;
			}
			selectOnly(id);
		},
		[orderedIds, selectOnly, cardDrag.draggedRef],
	);

	// Right-click keeps an existing multi-selection (menu acts on it),
	// otherwise selects just this card.
	const handleContextSelect = useCallback(
		(id: string) => {
			const { selectedIds } = useSelectionStore.getState();
			if (!selectedIds.has(id)) selectOnly(id);
		},
		[selectOnly],
	);

	// --- Marquee (rubber-band) selection over blank space -----------------
	// Coordinates live in content space (scroll-compensated); hits come from
	// pure layout math (virtualized cards may not even be mounted).
	const [marquee, setMarquee] = useState<Rect | null>(null);
	const marqueeStart = useRef<{ x: number; y: number } | null>(null);
	const marqueeActive = useRef(false);

	const toContentPoint = (event: React.PointerEvent) => {
		const el = scrollRef.current;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		return {
			x: event.clientX - rect.left - PADDING,
			y: event.clientY - rect.top + el.scrollTop - PADDING,
		};
	};

	const onPointerDown = (event: React.PointerEvent) => {
		if (event.button !== 0) return;
		// Cards (and anything interactive) own their own clicks.
		if ((event.target as HTMLElement).closest("button")) return;
		const point = toContentPoint(event);
		if (!point) return;
		marqueeStart.current = point;
		marqueeActive.current = false;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	};

	const onPointerMove = (event: React.PointerEvent) => {
		const start = marqueeStart.current;
		if (!start) return;
		const point = toContentPoint(event);
		if (!point) return;
		if (
			!marqueeActive.current &&
			Math.hypot(point.x - start.x, point.y - start.y) < MARQUEE_THRESHOLD
		) {
			return;
		}
		marqueeActive.current = true;
		event.preventDefault();
		const rect: Rect = {
			left: Math.min(start.x, point.x),
			top: Math.min(start.y, point.y),
			right: Math.max(start.x, point.x),
			bottom: Math.max(start.y, point.y),
		};
		setMarquee(rect);
		useSelectionStore.getState().selectMany(itemsInRect(layout, rect), null);
	};

	const onPointerUp = () => {
		if (marqueeStart.current && !marqueeActive.current) {
			// A plain click on blank space clears the selection.
			useSelectionStore.getState().clear();
		}
		marqueeStart.current = null;
		marqueeActive.current = false;
		setMarquee(null);
	};

	return (
		<>
			<div
				ref={scrollRef}
				className="h-full select-none overflow-y-auto"
				style={{ padding: PADDING }}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
			>
				<div
					className="relative"
					style={{ height: layout.totalHeight, width: contentWidth }}
				>
					{marquee && (
						<div
							className="pointer-events-none absolute z-10 rounded-sm border border-primary bg-primary/10"
							style={{
								left: marquee.left,
								top: marquee.top,
								width: marquee.right - marquee.left,
								height: marquee.bottom - marquee.top,
							}}
						/>
					)}
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
													durationMs={asset.duration_ms}
													width={item.width}
													imageHeight={item.imageHeight}
													captionHeight={CAPTION_HEIGHT}
													meta={
														formatDimensions(asset.width, asset.height) ??
														formatBytes(asset.size ?? 0)
													}
													onSelect={handleSelect}
													onContextSelect={handleContextSelect}
													onOpen={onOpen}
													onPointerDown={cardDrag.onPointerDown(item.id)}
												/>
											</ContextMenuTrigger>
											<ContextMenuContent>
												<AssetContextItems
													assetId={item.id}
													ext={asset.ext}
													inTrash={inTrash}
													currentFolderId={currentFolderId}
													onAddToFolder={setPickerIds}
													onCompare={setCompareIds}
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
			<FolderPicker
				open={pickerIds !== null}
				onOpenChange={(next) => {
					if (!next) setPickerIds(null);
				}}
				assetIds={pickerIds ?? []}
			/>
			{compareAssets.length >= 2 && (
				<Compare assets={compareAssets} onClose={() => setCompareIds(null)} />
			)}
		</>
	);
}
