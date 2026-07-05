/**
 * Recently-used folders — the folder picker surfaces these at the top so
 * frequent targets are one click away without scrolling the whole tree.
 * Persisted to localStorage; most-recent first, capped.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX_RECENT = 8;

type RecentFoldersState = {
	ids: string[];
	push: (id: string) => void;
};

export const useRecentFoldersStore = create<RecentFoldersState>()(
	persist(
		(set) => ({
			ids: [],
			push: (id) =>
				set((state) => ({
					ids: [id, ...state.ids.filter((x) => x !== id)].slice(0, MAX_RECENT),
				})),
		}),
		{ name: "recent-folders" },
	),
);
