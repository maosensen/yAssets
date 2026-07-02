/**
 * Deterministic fixture data — used by the M0 grid performance spike and by
 * unit tests that need realistic asset shapes without IPC.
 */

export type FixtureAsset = {
	id: string;
	name: string;
	width: number;
	height: number;
};

/** Small deterministic PRNG (mulberry32) so fixtures are stable across runs. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Realistic aspect-ratio mix: photos, portraits, screenshots, panoramas. */
const RATIO_POOL = [
	4 / 3,
	3 / 4,
	16 / 9,
	9 / 16,
	1,
	1,
	3 / 2,
	2 / 3,
	21 / 9, // panorama
	0.4, // tall screenshot
];

export function makeFixtureAssets(count: number, seed = 42): FixtureAsset[] {
	const rand = mulberry32(seed);
	return Array.from({ length: count }, (_, i) => {
		const ratio = RATIO_POOL[Math.floor(rand() * RATIO_POOL.length)] ?? 1;
		const height = 600 + Math.floor(rand() * 2400);
		return {
			id: `fixture${i.toString(36).padStart(14, "0")}`,
			name: `fixture-${i}.png`,
			width: Math.max(1, Math.round(height * ratio)),
			height,
		};
	});
}
