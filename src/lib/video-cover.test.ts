import { describe, expect, it } from "vitest";
import { luminanceVariance } from "./video-cover";

/** Build RGBA pixel data (alpha 255) from a list of [r,g,b] triples. */
function rgba(pixels: Array<[number, number, number]>): Uint8ClampedArray {
	const data = new Uint8ClampedArray(pixels.length * 4);
	pixels.forEach(([r, g, b], i) => {
		data[i * 4] = r;
		data[i * 4 + 1] = g;
		data[i * 4 + 2] = b;
		data[i * 4 + 3] = 255;
	});
	return data;
}

const fill = (n: number, rgb: [number, number, number]) =>
	rgba(Array.from({ length: n }, () => rgb));

describe("luminanceVariance", () => {
	it("is 0 for a flat black frame (the black-cover case we skip)", () => {
		expect(luminanceVariance(fill(100, [0, 0, 0]))).toBe(0);
	});

	it("is ~0 for any solid color", () => {
		expect(luminanceVariance(fill(100, [128, 128, 128]))).toBeCloseTo(0, 5);
		expect(luminanceVariance(fill(100, [200, 30, 90]))).toBeCloseTo(0, 5);
	});

	it("is high for a high-contrast frame", () => {
		const px = Array.from(
			{ length: 100 },
			(_, i) =>
				(i % 2 === 0 ? [0, 0, 0] : [255, 255, 255]) as [number, number, number],
		);
		expect(luminanceVariance(rgba(px))).toBeGreaterThan(4000);
	});

	it("ranks a detailed frame above a near-black one", () => {
		const nearBlack = fill(100, [8, 8, 8]);
		const detailed = rgba(
			Array.from(
				{ length: 100 },
				(_, i) =>
					[(i * 2) % 256, (i * 5) % 256, (i * 3) % 256] as [
						number,
						number,
						number,
					],
			),
		);
		expect(luminanceVariance(detailed)).toBeGreaterThan(
			luminanceVariance(nearBlack),
		);
	});

	it("returns 0 for empty input", () => {
		expect(luminanceVariance(new Uint8ClampedArray(0))).toBe(0);
	});
});
