/**
 * Pointer-drag source for grid cards. Returns an `onPointerDown` to spread on
 * a card; once the pointer passes a threshold it starts a drag of the current
 * selection (or just this card if it's not selected), tracks movement, and on
 * release performs the drop the hovered target registered.
 *
 * Drop targets set themselves via `useDragStore.setOver` on pointer enter and
 * clear on leave; the actual mutation runs here on pointer-up.
 */

import { useEffect, useRef } from "react";
import { commands } from "@/lib/bindings";
import { useTrashAssets } from "@/lib/queries/assets";
import { useAddAssetsToFolder } from "@/lib/queries/folders";
import { useDragStore } from "@/lib/stores/drag-store";
import { useSelectionStore } from "@/lib/stores/selection-store";

const DRAG_THRESHOLD = 5;

/** True once the pointer has left the window — the cue to hand off to the OS. */
function outsideWindow(event: PointerEvent): boolean {
	return (
		event.clientX <= 0 ||
		event.clientY <= 0 ||
		event.clientX >= window.innerWidth ||
		event.clientY >= window.innerHeight
	);
}

export function useCardDrag() {
	const addToFolder = useAddAssetsToFolder();
	const trashMutation = useTrashAssets();
	// True briefly after a drag so the trailing click doesn't re-select.
	const draggedRef = useRef(false);

	// Global listeners live for the drag's duration; installed lazily on down.
	useEffect(() => () => useDragStore.getState().end(), []);

	const onPointerDown = (assetId: string) => (event: React.PointerEvent) => {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey
		) {
			return; // let modifier-clicks do selection, not drag
		}
		const startX = event.clientX;
		const startY = event.clientY;
		let started = false;
		// Once we hand off to a native OS drag, this gesture is the OS's — our
		// listeners are gone and the in-app drop must not also fire.
		let handedOff = false;

		const move = (e: PointerEvent) => {
			if (!started) {
				if (
					Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD
				) {
					return;
				}
				started = true;
				draggedRef.current = true;
				// Drag the selection if this card is part of it, else just it.
				const { selectedIds } = useSelectionStore.getState();
				const ids =
					selectedIds.has(assetId) && selectedIds.size > 0
						? [...selectedIds]
						: [assetId];
				useDragStore.getState().start(ids, e.clientX, e.clientY);
				return;
			}
			// The DOM ghost can't cross the window edge; once the pointer leaves,
			// hand the gesture to the OS as a real file drag (Finder, browser,
			// chat boxes). In-app targets (folder/trash) stay on this path.
			if (!handedOff && outsideWindow(e)) {
				handedOff = true;
				const { draggingIds } = useDragStore.getState();
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", up);
				useDragStore.getState().end();
				if (draggingIds.length > 0) {
					void commands.startAssetDrag(draggingIds).catch((err) => {
						console.error("start native drag failed", err);
					});
				}
				// Clear after the click that would otherwise follow this gesture.
				setTimeout(() => {
					draggedRef.current = false;
				}, 0);
				return;
			}
			useDragStore.getState().move(e.clientX, e.clientY);
		};

		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			if (!started) return;
			const { draggingIds, over } = useDragStore.getState();
			if (over && draggingIds.length > 0) {
				if (over.kind === "folder") {
					addToFolder.mutate({ assetIds: draggingIds, folderId: over.id });
				} else {
					trashMutation.mutate(draggingIds);
				}
			}
			useDragStore.getState().end();
			// Clear after the click event that follows this pointerup.
			setTimeout(() => {
				draggedRef.current = false;
			}, 0);
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	return { onPointerDown, draggedRef };
}
