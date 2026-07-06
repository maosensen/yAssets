/**
 * Cross-component UI signals — tiny intents that don't belong to data state.
 * `renameSignal` bumps when the user hits Enter/F2 on a selected card; the
 * inspector's name field listens and grabs focus.
 *
 * `preferencesOpen` lives here rather than as local component state so it
 * survives the `I18nProvider` remount on a language switch — the language
 * switcher is inside the Preferences dialog, so the dialog must stay open (and
 * re-render translated) across the switch instead of vanishing.
 */

import { create } from "zustand";

type UiState = {
	renameSignal: number;
	requestRename: () => void;
	preferencesOpen: boolean;
	setPreferencesOpen: (open: boolean) => void;
	aboutOpen: boolean;
	setAboutOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>()((set) => ({
	renameSignal: 0,
	requestRename: () =>
		set((state) => ({ renameSignal: state.renameSignal + 1 })),
	preferencesOpen: false,
	setPreferencesOpen: (open) => set({ preferencesOpen: open }),
	aboutOpen: false,
	setAboutOpen: (open) => set({ aboutOpen: open }),
}));
