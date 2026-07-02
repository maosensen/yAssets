import { describe, expect, it } from "vitest";
import { formatBytes, formatDateTime, formatDimensions } from "./format";

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
