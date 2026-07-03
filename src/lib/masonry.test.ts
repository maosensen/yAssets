import { describe, expect, it } from "vitest";
import {
	clampRatio,
	computeJustifiedLayout,
	itemsInRect,
	MAX_RATIO,
	type MasonryOptions,
	MIN_RATIO,
} from "./masonry";

const OPTS: MasonryOptions = {
	containerWidth: 1000,
	targetRowHeight: 200,
	gap: 8,
	captionHeight: 36,
};

function items(...ratios: number[]) {
	return ratios.map((ratio, i) => ({ id: `a${i}`, ratio }));
}

describe("clampRatio", () => {
	it("clamps extremes and falls back to 1 for invalid input", () => {
		expect(clampRatio(100)).toBe(MAX_RATIO);
		expect(clampRatio(0.01)).toBe(MIN_RATIO);
		expect(clampRatio(1.5)).toBe(1.5);
		expect(clampRatio(0)).toBe(1);
		expect(clampRatio(-3)).toBe(1);
		expect(clampRatio(Number.NaN)).toBe(1);
		expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe("computeJustifiedLayout", () => {
	it("returns an empty layout for empty input", () => {
		const layout = computeJustifiedLayout([], OPTS);
		expect(layout.rows).toHaveLength(0);
		expect(layout.totalHeight).toBe(0);
		expect(layout.rowIndexOf.size).toBe(0);
	});

	it("returns an empty layout for zero container width", () => {
		const layout = computeJustifiedLayout(items(1, 1), {
			...OPTS,
			containerWidth: 0,
		});
		expect(layout.rows).toHaveLength(0);
	});

	it("fills closed rows to the container width exactly", () => {
		// 8 squares at 200px = 1600px content > 1000px container → row closes.
		const layout = computeJustifiedLayout(items(1, 1, 1, 1, 1, 1, 1, 1), OPTS);
		expect(layout.rows.length).toBeGreaterThan(1);

		for (const row of layout.rows.slice(0, -1)) {
			const last = row.items[row.items.length - 1];
			expect(last).toBeDefined();
			if (!last) continue;
			expect(last.left + last.width).toBeCloseTo(OPTS.containerWidth, 6);
		}
	});

	it("never upscales closed rows above targetRowHeight", () => {
		const layout = computeJustifiedLayout(
			items(1.5, 0.8, 1.2, 1, 2, 0.7, 1.1, 1.6, 0.9),
			OPTS,
		);
		for (const row of layout.rows.slice(0, -1)) {
			for (const item of row.items) {
				expect(item.imageHeight).toBeLessThanOrEqual(OPTS.targetRowHeight);
			}
		}
	});

	it("keeps the final partial row at targetRowHeight (no stretching)", () => {
		// Two squares at 200px = 408px < 1000px → single unfilled row.
		const layout = computeJustifiedLayout(items(1, 1), OPTS);
		expect(layout.rows).toHaveLength(1);
		const row = layout.rows[0];
		expect(row.items[0]?.imageHeight).toBe(OPTS.targetRowHeight);
		const last = row.items[row.items.length - 1];
		expect(last).toBeDefined();
		if (last) {
			expect(last.left + last.width).toBeLessThan(OPTS.containerWidth);
		}
	});

	it("includes captionHeight in row height and stacks rows with gap", () => {
		const layout = computeJustifiedLayout(items(1, 1, 1, 1, 1, 1, 1, 1), OPTS);
		const [first, second] = layout.rows;
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		if (!first || !second) return;
		expect(first.height).toBeCloseTo(
			first.items[0].imageHeight + OPTS.captionHeight,
			6,
		);
		expect(second.top).toBeCloseTo(first.top + first.height + OPTS.gap, 6);
	});

	it("computes totalHeight as the bottom edge of the last row", () => {
		const layout = computeJustifiedLayout(
			items(1, 1.3, 0.8, 1, 1.7, 0.6, 1, 1),
			OPTS,
		);
		const last = layout.rows[layout.rows.length - 1];
		expect(last).toBeDefined();
		if (!last) return;
		expect(layout.totalHeight).toBeCloseTo(last.top + last.height, 6);
	});

	it("maps every item id to its row index", () => {
		const input = items(1, 2, 0.5, 1, 1, 3, 0.4, 1, 1.2, 1);
		const layout = computeJustifiedLayout(input, OPTS);
		expect(layout.rowIndexOf.size).toBe(input.length);
		for (const [id, rowIndex] of layout.rowIndexOf) {
			const row = layout.rows[rowIndex];
			expect(row).toBeDefined();
			expect(row?.items.some((item) => item.id === id)).toBe(true);
		}
	});

	it("shrinks a single ultra-wide item to fit the container", () => {
		// Clamped to MAX_RATIO=5: 5×200=1000 ≥ 1000 → closes as its own row.
		const layout = computeJustifiedLayout(items(50), OPTS);
		expect(layout.rows).toHaveLength(1);
		const item = layout.rows[0]?.items[0];
		expect(item).toBeDefined();
		if (!item) return;
		expect(item.width).toBeCloseTo(OPTS.containerWidth, 6);
		expect(item.imageHeight).toBeLessThanOrEqual(OPTS.targetRowHeight);
	});

	it("treats invalid ratios as 1:1 squares", () => {
		const layout = computeJustifiedLayout(
			[{ id: "bad", ratio: Number.NaN }],
			OPTS,
		);
		const item = layout.rows[0]?.items[0];
		expect(item).toBeDefined();
		if (!item) return;
		expect(item.width).toBeCloseTo(item.imageHeight, 6);
	});

	it("itemsInRect hit-tests card boxes without touching the DOM", () => {
		// 8 squares → two rows at 1000px width.
		const layout = computeJustifiedLayout(items(1, 1, 1, 1, 1, 1, 1, 1), OPTS);
		const [first, second] = layout.rows;
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		if (!first || !second) return;

		// A rect fully inside the first row's first card.
		const firstItem = first.items[0];
		const single = itemsInRect(layout, {
			left: firstItem.left + 1,
			top: first.top + 1,
			right: firstItem.left + 2,
			bottom: first.top + 2,
		});
		expect(single).toEqual([firstItem.id]);

		// A rect spanning both rows horizontally across everything.
		const all = itemsInRect(layout, {
			left: 0,
			top: 0,
			right: OPTS.containerWidth,
			bottom: layout.totalHeight,
		});
		expect(all).toHaveLength(8);

		// A rect in the vertical gap between rows hits nothing… but a rect
		// over row 2 only hits row-2 items.
		const rowTwoOnly = itemsInRect(layout, {
			left: 0,
			top: second.top + 1,
			right: OPTS.containerWidth,
			bottom: second.top + 2,
		});
		expect(rowTwoOnly.every((id) => layout.rowIndexOf.get(id) === 1)).toBe(
			true,
		);

		// Degenerate rect far below everything.
		expect(
			itemsInRect(layout, {
				left: 0,
				top: layout.totalHeight + 100,
				right: 10,
				bottom: layout.totalHeight + 110,
			}),
		).toHaveLength(0);
	});

	it("lays out 10k items in O(n) time without pathologies", () => {
		const many = Array.from({ length: 10_000 }, (_, i) => ({
			id: `x${i}`,
			ratio: 0.5 + ((i * 7919) % 100) / 50,
		}));
		const start = performance.now();
		const layout = computeJustifiedLayout(many, OPTS);
		const elapsed = performance.now() - start;

		expect(layout.rowIndexOf.size).toBe(many.length);
		expect(layout.rows.length).toBeGreaterThan(100);
		// Generous bound — actual is ~single-digit ms; this guards regressions
		// like accidental O(n²) behavior, not micro-perf.
		expect(elapsed).toBeLessThan(500);
	});
});
