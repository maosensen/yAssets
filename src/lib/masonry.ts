/**
 * Justified-rows masonry layout — pure math, no DOM measurement.
 *
 * Positions are computed exclusively from aspect ratios stored in the DB
 * (AGENTS.md hard rule: never wait for image loads or measure elements).
 * The grid virtualizes *rows*: each row's height is exact, so
 * `useVirtualizer.estimateSize` returns precise values and the scrollbar
 * never jumps.
 *
 * Algorithm: accumulate items left-to-right at `targetRowHeight`; once the
 * row's content width reaches the container width, close the row and scale
 * it down so it fills the width exactly. Mid rows therefore only ever
 * shrink (≤ targetRowHeight); the final row keeps `targetRowHeight` and is
 * never stretched to fill.
 *
 * The column-waterfall variant (react-virtual `lanes`) is a sealed phase-2
 * alternative — swap the function behind this interface, the grid only
 * consumes `MasonryLayout`.
 */

export type MasonryItemInput = {
	id: string;
	/** width / height. Assets without dimensions (non-image formats) pass 1. */
	ratio: number;
};

export type MasonryItem = {
	id: string;
	/** X offset inside the row, in px. */
	left: number;
	width: number;
	/** Image box height (row height without the caption strip). */
	imageHeight: number;
};

export type MasonryRow = {
	/** Y offset of the row's top edge inside the scroll content. */
	top: number;
	/** Full row height including `captionHeight` (excluding the trailing gap). */
	height: number;
	items: MasonryItem[];
};

export type MasonryLayout = {
	rows: MasonryRow[];
	/** Total scroll-content height in px. */
	totalHeight: number;
	/** Asset id → row index, for scroll anchoring (zoom / resize restore). */
	rowIndexOf: Map<string, number>;
};

export type MasonryOptions = {
	containerWidth: number;
	/** Desired image-box height; the zoom slider maps to exactly this. */
	targetRowHeight: number;
	/** Horizontal and vertical spacing between cards, in px. */
	gap: number;
	/** Fixed height of the caption strip (name + meta) under each image. */
	captionHeight: number;
};

/** Panoramas / tall screenshots are clamped so one item can't blow up a row. */
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 5;

export function clampRatio(ratio: number): number {
	if (!Number.isFinite(ratio) || ratio <= 0) return 1;
	return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

export function computeJustifiedLayout(
	items: readonly MasonryItemInput[],
	options: MasonryOptions,
): MasonryLayout {
	const { containerWidth, targetRowHeight, gap, captionHeight } = options;
	const rows: MasonryRow[] = [];
	const rowIndexOf = new Map<string, number>();

	if (items.length === 0 || containerWidth <= 0 || targetRowHeight <= 0) {
		return { rows, totalHeight: 0, rowIndexOf };
	}

	let top = 0;
	let pending: { id: string; ratio: number }[] = [];
	let ratioSum = 0;

	const closeRow = (imageHeight: number) => {
		const rowIndex = rows.length;
		let left = 0;
		const rowItems: MasonryItem[] = pending.map((entry, i) => {
			const width = entry.ratio * imageHeight;
			const item: MasonryItem = { id: entry.id, left, width, imageHeight };
			left += width + (i < pending.length - 1 ? gap : 0);
			rowIndexOf.set(entry.id, rowIndex);
			return item;
		});
		const height = imageHeight + captionHeight;
		rows.push({ top, height, items: rowItems });
		top += height + gap;
		pending = [];
		ratioSum = 0;
	};

	for (const input of items) {
		const ratio = clampRatio(input.ratio);
		pending.push({ id: input.id, ratio });
		ratioSum += ratio;

		const gapsWidth = gap * (pending.length - 1);
		const contentWidth = ratioSum * targetRowHeight + gapsWidth;
		if (contentWidth >= containerWidth) {
			// Scale the row down so it fills the container width exactly.
			// contentWidth ≥ containerWidth ⇒ imageHeight ≤ targetRowHeight,
			// so mid rows never upscale.
			const imageHeight = (containerWidth - gapsWidth) / ratioSum;
			closeRow(Math.max(1, imageHeight));
		}
	}

	// Final partial row: keep the target height, never stretch to fill.
	if (pending.length > 0) {
		closeRow(targetRowHeight);
	}

	return { rows, totalHeight: top - gap, rowIndexOf };
}
