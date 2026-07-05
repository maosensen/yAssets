import { describe, expect, it } from "vitest";
import {
	formatBytes,
	formatDateTime,
	formatDimensions,
	formatDuration,
} from "./format";

describe("formatBytes", () => {
	it("handles the unit ladder", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
		expect(formatBytes(3.4 * 1024 * 1024 * 1024)).toBe("3.4 GB");
	});

	it("rounds three-digit values to integers", () => {
		expect(formatBytes(200 * 1024)).toBe("200 KB");
	});

	it("is defensive about garbage", () => {
		expect(formatBytes(-1)).toBe("0 B");
		expect(formatBytes(Number.NaN)).toBe("0 B");
	});
});

describe("formatDimensions", () => {
	it("joins width and height", () => {
		expect(formatDimensions(800, 600)).toBe("800 × 600");
	});
	it("returns null when either side is missing", () => {
		expect(formatDimensions(null, 600)).toBeNull();
		expect(formatDimensions(800, null)).toBeNull();
	});
});

describe("formatDuration", () => {
	it("zero-pads mm:ss and adds hours only when needed", () => {
		expect(formatDuration(8_000)).toBe("00:08");
		expect(formatDuration(63_000)).toBe("01:03");
		expect(formatDuration(3_803_000)).toBe("1:03:23");
	});
	it("rounds to the nearest second", () => {
		expect(formatDuration(8_600)).toBe("00:09");
	});
	it("returns null for unknown or garbage input", () => {
		expect(formatDuration(null)).toBeNull();
		expect(formatDuration(undefined)).toBeNull();
		expect(formatDuration(-1)).toBeNull();
		expect(formatDuration(Number.NaN)).toBeNull();
		// 0 = length couldn't be probed → no badge, not "00:00".
		expect(formatDuration(0)).toBeNull();
	});
});

describe("formatDateTime", () => {
	it("formats unix ms and dashes out null", () => {
		expect(formatDateTime(null)).toBe("—");
		expect(formatDateTime(undefined)).toBe("—");
		// Fixed instant, local-TZ agnostic assertion: just shape.
		expect(formatDateTime(1_700_000_000_000)).toMatch(
			/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
		);
	});
});
