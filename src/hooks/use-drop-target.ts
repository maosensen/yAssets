/**
 * Drop-target side of the in-app pointer drag. Spread the returned handlers on
 * a folder row / trash entry; while a drag is active and hovering, it marks
 * itself in the drag store (which the source reads on release) and reports
 * `isOver` so the target can highlight.
 */

import { useState } from "react";
import { type DropTarget, useDragStore } from "@/lib/stores/drag-store";

export function useDropTarget(target: DropTarget) {
	const [isOver, setIsOver] = useState(false);

	const active = () => useDragStore.getState().draggingIds.length > 0;

	const onPointerEnter = () => {
		if (!active()) return;
		setIsOver(true);
		useDragStore.getState().setOver(target);
	};
	const onPointerLeave = () => {
		if (!isOver) return;
		setIsOver(false);
		const current = useDragStore.getState().over;
		// Only clear if we're still the registered target.
		if (current && sameTarget(current, target)) {
			useDragStore.getState().setOver(null);
		}
	};
	// Pointerup ends the drag globally (source handles the drop); just
	// drop our local highlight.
	const onPointerUp = () => setIsOver(false);

	return {
		isOver: isOver && active(),
		onPointerEnter,
		onPointerLeave,
		onPointerUp,
	};
}

function sameTarget(a: DropTarget, b: DropTarget): boolean {
	if (a.kind === "folder" && b.kind === "folder") return a.id === b.id;
	return a.kind === b.kind;
}
