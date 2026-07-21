/**
 * In-app pointer-drag state for reordering / reparenting sidebar folders.
 *
 * Kept separate from the asset drag store (drag-store.ts): a folder drag has
 * its own target semantics — a row splits into three zones, "before" / "into" /
 * "after", so one gesture can both reorder among siblings and move into another
 * folder. The two drags are never active at once.
 */

import { create } from "zustand";

/** Which third of a row's height the pointer is over. */
export type FolderDropZone = "before" | "into" | "after";

export type FolderDropTarget = { folderId: string; zone: FolderDropZone };

const NO_DISABLED: ReadonlySet<string> = new Set();

type FolderDragState = {
	/** Folder id being dragged; null when no folder drag is active. */
	draggingId: string | null;
	/** Display name of the dragged folder (for the ghost). */
	draggingName: string | null;
	/** Ids that can't receive the drop — the dragged folder and its subtree. */
	disabledIds: ReadonlySet<string>;
	/** Live pointer position (for the drag ghost). */
	pointer: { x: number; y: number };
	/** The row + zone currently under the pointer, if any. */
	target: FolderDropTarget | null;
	start: (
		id: string,
		name: string,
		disabledIds: ReadonlySet<string>,
		x: number,
		y: number,
	) => void;
	move: (x: number, y: number) => void;
	setTarget: (target: FolderDropTarget | null) => void;
	end: () => void;
};

export const useFolderDragStore = create<FolderDragState>()((set) => ({
	draggingId: null,
	draggingName: null,
	disabledIds: NO_DISABLED,
	pointer: { x: 0, y: 0 },
	target: null,
	start: (id, name, disabledIds, x, y) =>
		set({
			draggingId: id,
			draggingName: name,
			disabledIds,
			pointer: { x, y },
			target: null,
		}),
	move: (x, y) => set({ pointer: { x, y } }),
	setTarget: (target) => set({ target }),
	end: () =>
		set({
			draggingId: null,
			draggingName: null,
			disabledIds: NO_DISABLED,
			target: null,
		}),
}));
