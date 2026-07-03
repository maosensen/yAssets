/**
 * In-app pointer-drag state (cards → folder/trash targets).
 *
 * Native HTML5 DnD is unusable under Tauri (drag-drop is intercepted for OS
 * file drops, see tauri-events.ts), so dragging is pointer-based: the grid
 * starts a drag, drop targets register hover, and the released target runs
 * the drop. This store is the thin channel between them.
 */

import { create } from "zustand";

/** Where the pointer currently hovers during a drag. */
export type DropTarget = { kind: "folder"; id: string } | { kind: "trash" };

type DragState = {
	/** Asset ids being dragged; empty when no drag is active. */
	draggingIds: string[];
	/** Live pointer position (for the drag ghost). */
	pointer: { x: number; y: number };
	/** The drop target currently under the pointer, if any. */
	over: DropTarget | null;
	start: (ids: string[], x: number, y: number) => void;
	move: (x: number, y: number) => void;
	setOver: (target: DropTarget | null) => void;
	end: () => void;
};

export const useDragStore = create<DragState>()((set) => ({
	draggingIds: [],
	pointer: { x: 0, y: 0 },
	over: null,
	start: (ids, x, y) =>
		set({ draggingIds: ids, pointer: { x, y }, over: null }),
	move: (x, y) => set({ pointer: { x, y } }),
	setOver: (target) => set({ over: target }),
	end: () => set({ draggingIds: [], over: null }),
}));
