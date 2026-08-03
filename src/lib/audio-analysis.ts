/**
 * Pure audio-analysis helpers for the audio viewer: waveform bucketing and the
 * acoustic numbers shown next to the transport. No Web Audio types leak in —
 * callers hand over plain Float32Array channel data — so all of this is
 * unit-testable without an AudioContext.
 */

/** dBFS floor reported instead of -Infinity for digital silence. */
export const DBFS_FLOOR = -100;

/**
 * Per-bucket peak magnitude (0..1) for drawing a waveform. Buckets span the
 * samples evenly; a bucket wider than the remaining samples just sees fewer.
 * Returns `buckets` values (empty input ⇒ all zeros) so the drawing code never
 * has to special-case short or silent files.
 */
export function computeWaveformPeaks(
	samples: Float32Array,
	buckets: number,
): Float32Array {
	const out = new Float32Array(Math.max(0, Math.floor(buckets)));
	if (out.length === 0 || samples.length === 0) return out;

	const per = samples.length / out.length;
	for (let bucket = 0; bucket < out.length; bucket++) {
		const start = Math.floor(bucket * per);
		const end = Math.min(
			samples.length,
			Math.max(start + 1, Math.floor((bucket + 1) * per)),
		);
		let peak = 0;
		for (let i = start; i < end; i++) {
			const magnitude = Math.abs(samples[i] as number);
			if (magnitude > peak) peak = magnitude;
		}
		out[bucket] = peak;
	}
	return out;
}

/** Highest absolute sample across every channel, linear 0..1(+). */
export function peakAmplitude(channels: readonly Float32Array[]): number {
	let peak = 0;
	for (const channel of channels) {
		for (let i = 0; i < channel.length; i++) {
			const magnitude = Math.abs(channel[i] as number);
			if (magnitude > peak) peak = magnitude;
		}
	}
	return peak;
}

/** Root-mean-square level across every channel, linear 0..1(+). */
export function rmsAmplitude(channels: readonly Float32Array[]): number {
	let sum = 0;
	let count = 0;
	for (const channel of channels) {
		for (let i = 0; i < channel.length; i++) {
			const sample = channel[i] as number;
			sum += sample * sample;
		}
		count += channel.length;
	}
	if (count === 0) return 0;
	return Math.sqrt(sum / count);
}

/** Linear amplitude → dBFS, with digital silence clamped to `DBFS_FLOOR`. */
export function toDbfs(linear: number): number {
	if (!(linear > 0)) return DBFS_FLOOR;
	return Math.max(DBFS_FLOOR, 20 * Math.log10(linear));
}

/** `-6.0 dB` style label; the floor reads as `-∞ dB`. */
export function formatDbfs(db: number): string {
	if (db <= DBFS_FLOOR) return "-∞ dB";
	return `${db.toFixed(1)} dB`;
}

/**
 * Average bitrate from container size and duration — the honest way to report
 * it without parsing codec headers. Null when either input is unusable.
 */
export function estimateBitrateKbps(
	sizeBytes: number | null | undefined,
	durationSec: number | null | undefined,
): number | null {
	if (!sizeBytes || !durationSec || sizeBytes <= 0 || durationSec <= 0) {
		return null;
	}
	return Math.round((sizeBytes * 8) / durationSec / 1000);
}

/** `1` → "Mono", `2` → "Stereo", anything else → "N ch". */
export function channelLayout(channels: number): string {
	if (channels === 1) return "Mono";
	if (channels === 2) return "Stereo";
	return `${channels} ch`;
}

/** `m:ss` clock for the transport (seconds, NaN-safe). */
export function formatClock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60);
	const secs = total % 60;
	return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
