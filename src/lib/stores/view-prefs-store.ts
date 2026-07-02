/**
 * Grid view preferences — zoom level and sort order.
 *
 * Persisted to localStorage (synchronous hydration, no flash; same precedent
 * as the theme provider). Move to tauri-plugin-store only if Rust ever needs
 * to read these.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SortDir, SortKey } from "@/lib/bindings";

export const MIN_ROW_HEIGHT = 96;
export const MAX_ROW_HEIGHT = 320;
export const DEFAULT_ROW_HEIGHT = 180;

type ViewPrefsState = {
	/** Masonry target row height in px — the zoom slider maps to this. */
	targetRowHeight: number;
	sort: SortKey;
	dir: SortDir;
	setTargetRowHeight: (value: number) => void;
	setSort: (sort: SortKey, dir: SortDir) => void;
};

export const useViewPrefsStore = create<ViewPrefsState>()(
	persist(
		(set) => ({
			targetRowHeight: DEFAULT_ROW_HEIGHT,
			sort: "ImportedAt",
			dir: "Desc",
			setTargetRowHeight: (value) =>
				set({
					targetRowHeight: Math.min(
						MAX_ROW_HEIGHT,
						Math.max(MIN_ROW_HEIGHT, Math.round(value)),
					),
				}),
			setSort: (sort, dir) => set({ sort, dir }),
		}),
		{ name: "yassets-view-prefs" },
	),
);
