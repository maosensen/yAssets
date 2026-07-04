/**
 * Cross-component UI signals — tiny intents that don't belong to data state.
 * `renameSignal` bumps when the user hits Enter/F2 on a selected card; the
 * inspector's name field listens and grabs focus.
 */

import { create } from "zustand";

type UiState = {
	renameSignal: number;
	requestRename: () => void;
};

export const useUiStore = create<UiState>()((set) => ({
	renameSignal: 0,
	requestRename: () =>
		set((state) => ({ renameSignal: state.renameSignal + 1 })),
}));
