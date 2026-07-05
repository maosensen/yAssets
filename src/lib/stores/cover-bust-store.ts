/**
 * Cache-bust tokens for regenerated thumbnails. The yasset thumb route serves
 * `immutable` (great for grid scroll), so a re-generated cover at the same URL
 * would show the stale cached image. When a cover is regenerated we bump the
 * asset's token; the card appends it as `?v=<n>` to force a fresh fetch. Only
 * regenerated ids ever get a token — normal cards keep the cached fast path.
 */

import { create } from "zustand";
import { thumbUrl } from "@/lib/media";

type CoverBustState = {
	tokens: ReadonlyMap<string, number>;
	bump: (id: string) => void;
};

export const useCoverBustStore = create<CoverBustState>((set) => ({
	tokens: new Map(),
	bump: (id) =>
		set((state) => {
			const next = new Map(state.tokens);
			next.set(id, (next.get(id) ?? 0) + 1);
			return { tokens: next };
		}),
}));

/**
 * The thumbnail URL for an asset, cache-busted if its cover was regenerated
 * this session. Every thumb consumer (grid card, inspector, video poster)
 * MUST use this — a bare thumbUrl() serves the immutable-cached old frame.
 */
export function useThumbSrc(id: string): string {
	const token = useCoverBustStore((state) => state.tokens.get(id));
	return token ? `${thumbUrl(id)}?v=${token}` : thumbUrl(id);
}
