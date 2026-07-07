/**
 * Discover source settings — the per-provider API keys.
 *
 * Persisted to localStorage (same pattern as theme / locale / view-prefs). Each
 * key is the user's own, sent only to its provider. Wallhaven and Openverse
 * work keyless; Pixabay and Pexels require a key. Never logged.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

type SourcesState = {
	wallhavenApiKey: string;
	setWallhavenApiKey: (key: string) => void;
	pixabayApiKey: string;
	setPixabayApiKey: (key: string) => void;
	pexelsApiKey: string;
	setPexelsApiKey: (key: string) => void;
};

export const useSourcesStore = create<SourcesState>()(
	persist(
		(set) => ({
			wallhavenApiKey: "",
			setWallhavenApiKey: (key) => set({ wallhavenApiKey: key.trim() }),
			pixabayApiKey: "",
			setPixabayApiKey: (key) => set({ pixabayApiKey: key.trim() }),
			pexelsApiKey: "",
			setPexelsApiKey: (key) => set({ pexelsApiKey: key.trim() }),
		}),
		{ name: "yassets-sources" },
	),
);
