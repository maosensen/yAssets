/**
 * Grid selection. Cards subscribe with a boolean selector
 * (`s.selectedIds.has(id)`), so a selection change re-renders only the two
 * affected cards, never the whole grid.
 *
 * `anchorId` seeds phase-2 shift-range selection; single-select ships first.
 */

import { create } from "zustand";

type SelectionState = {
	selectedIds: ReadonlySet<string>;
	anchorId: string | null;
	selectOnly: (id: string) => void;
	toggle: (id: string) => void;
	clear: () => void;
};

export const useSelectionStore = create<SelectionState>()((set) => ({
	selectedIds: new Set<string>(),
	anchorId: null,
	selectOnly: (id) => set({ selectedIds: new Set([id]), anchorId: id }),
	toggle: (id) =>
		set((state) => {
			const next = new Set(state.selectedIds);
			if (!next.delete(id)) next.add(id);
			return { selectedIds: next, anchorId: id };
		}),
	clear: () => set({ selectedIds: new Set<string>(), anchorId: null }),
}));
