import { describe, expect, it } from "vitest";
import {
	channelLayout,
	computeWaveformPeaks,
	DBFS_FLOOR,
	estimateBitrateKbps,
	formatClock,
	formatDbfs,
	peakAmplitude,
	rmsAmplitude,
	toDbfs,
} from "./audio-analysis";

describe("computeWaveformPeaks", () => {
	it("returns one peak magnitude per bucket", () => {
		const samples = new Float32Array([0, 0.5, -1, 0.25]);
		expect([...computeWaveformPeaks(samples, 2)]).toEqual([0.5, 1]);
	});

	it("uses absolute magnitude (negative troughs count)", () => {
		const samples = new Float32Array([-0.8, 0.1]);
		// Float32 storage, so compare approximately.
		expect(computeWaveformPeaks(samples, 1)[0]).toBeCloseTo(0.8, 6);
	});

	it("still fills every bucket when buckets exceed samples", () => {
		const peaks = computeWaveformPeaks(new Float32Array([1, 1]), 5);
		expect(peaks).toHaveLength(5);
		// No bucket is left unwritten (each reads at least one sample).
		expect([...peaks].every((v) => v === 1)).toBe(true);
	});

	it("is all zeros for empty input, and empty for zero buckets", () => {
		expect([...computeWaveformPeaks(new Float32Array(), 3)]).toEqual([0, 0, 0]);
		expect(computeWaveformPeaks(new Float32Array([1]), 0)).toHaveLength(0);
	});
});

describe("peakAmplitude / rmsAmplitude", () => {
	const left = new Float32Array([0.5, -0.5]);
	const right = new Float32Array([1, 0]);

	it("peak spans every channel", () => {
		expect(peakAmplitude([left, right])).toBe(1);
	});

	it("rms averages over all samples of all channels", () => {
		// (0.25 + 0.25 + 1 + 0) / 4 = 0.375 → sqrt
		expect(rmsAmplitude([left, right])).toBeCloseTo(Math.sqrt(0.375), 6);
	});

	it("treats no samples as silence instead of dividing by zero", () => {
		expect(rmsAmplitude([])).toBe(0);
		expect(peakAmplitude([])).toBe(0);
	});
});

describe("toDbfs / formatDbfs", () => {
	it("maps full scale to 0 dB and half amplitude to about -6 dB", () => {
		expect(toDbfs(1)).toBeCloseTo(0, 6);
		expect(toDbfs(0.5)).toBeCloseTo(-6.02, 2);
	});

	it("clamps digital silence to the floor instead of -Infinity", () => {
		expect(toDbfs(0)).toBe(DBFS_FLOOR);
		expect(Number.isFinite(toDbfs(0))).toBe(true);
		expect(formatDbfs(toDbfs(0))).toBe("-∞ dB");
	});

	it("formats one decimal", () => {
		expect(formatDbfs(-6.02)).toBe("-6.0 dB");
	});
});

describe("estimateBitrateKbps", () => {
	it("derives kbps from size and duration", () => {
		// 1 MB over 60 s ≈ 140 kbps
		expect(estimateBitrateKbps(1_048_576, 60)).toBe(140);
	});

	it("returns null when either input is missing or zero", () => {
		expect(estimateBitrateKbps(0, 60)).toBeNull();
		expect(estimateBitrateKbps(1000, 0)).toBeNull();
		expect(estimateBitrateKbps(null, 60)).toBeNull();
		expect(estimateBitrateKbps(1000, undefined)).toBeNull();
	});
});

describe("channelLayout / formatClock", () => {
	it("names the common layouts", () => {
		expect(channelLayout(1)).toBe("Mono");
		expect(channelLayout(2)).toBe("Stereo");
		expect(channelLayout(6)).toBe("6 ch");
	});

	it("formats a zero-padded clock and survives NaN", () => {
		expect(formatClock(0)).toBe("0:00");
		expect(formatClock(9)).toBe("0:09");
		expect(formatClock(75)).toBe("1:15");
		expect(formatClock(Number.NaN)).toBe("0:00");
		expect(formatClock(-5)).toBe("0:00");
	});
});
