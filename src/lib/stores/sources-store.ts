/**
 * Discover source settings — currently the optional Wallhaven API key.
 *
 * Persisted to localStorage (same pattern as theme / locale / view-prefs). The
 * key is the user's own, sent only to Wallhaven; an empty key means SFW-only
 * browsing with no key. Never logged.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

type SourcesState = {
	wallhavenApiKey: string;
	setWallhavenApiKey: (key: string) => void;
};

export const useSourcesStore = create<SourcesState>()(
	persist(
		(set) => ({
			wallhavenApiKey: "",
			setWallhavenApiKey: (key) => set({ wallhavenApiKey: key.trim() }),
		}),
		{ name: "yassets-sources" },
	),
);
