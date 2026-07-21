/**
 * Pointer-drag for reordering / reparenting sidebar folders.
 *
 * `useFolderDragSource` is spread on a folder row to make it draggable (mirrors
 * `use-card-drag`, minus the OS hand-off — folders never leave the window).
 * `useFolderDropZone` is spread on each row to report which third of it the
 * pointer is over ("before" / "into" / "after") so the source can resolve the
 * drop on release. The two share `folder-drag-store`.
 */

import { useEffect, useRef, useState } from "react";
import type { Folder } from "@/lib/bindings";
import {
	collectSubtreeIds,
	type FolderNode,
	resolveFolderDrop,
} from "@/lib/folder-tree";
import { useReorderFolder } from "@/lib/queries/folders";
import {
	type FolderDropZone,
	useFolderDragStore,
} from "@/lib/stores/folder-drag-store";

const DRAG_THRESHOLD = 5;

export function useFolderDragSource(folders: readonly Folder[]) {
	const reorder = useReorderFolder();
	// True briefly after a drag so the trailing click doesn't navigate.
	const draggedRef = useRef(false);

	// End any in-flight drag if the tree unmounts mid-gesture.
	useEffect(() => () => useFolderDragStore.getState().end(), []);

	const onPointerDown = (node: FolderNode) => (event: React.PointerEvent) => {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey
		) {
			return; // let modifier-clicks / right-click through
		}
		const startX = event.clientX;
		const startY = event.clientY;
		let started = false;

		const move = (e: PointerEvent) => {
			if (!started) {
				if (
					Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD
				) {
					return;
				}
				started = true;
				draggedRef.current = true;
				useFolderDragStore
					.getState()
					.start(
						node.id,
						node.name,
						collectSubtreeIds(node),
						e.clientX,
						e.clientY,
					);
				return;
			}
			useFolderDragStore.getState().move(e.clientX, e.clientY);
		};

		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			if (!started) return;
			const { draggingId, target } = useFolderDragStore.getState();
			if (draggingId && target) {
				const drop = resolveFolderDrop(folders, draggingId, target);
				if (drop) {
					reorder.mutate({
						id: draggingId,
						newParentId: drop.newParentId,
						index: drop.index,
					});
				}
			}
			useFolderDragStore.getState().end();
			// Clear after the click that would otherwise follow this pointerup.
			setTimeout(() => {
				draggedRef.current = false;
			}, 0);
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	return { onPointerDown, draggedRef };
}

export function useFolderDropZone(node: FolderNode) {
	const draggingId = useFolderDragStore((state) => state.draggingId);
	const disabledIds = useFolderDragStore((state) => state.disabledIds);
	const [zone, setZone] = useState<FolderDropZone | null>(null);

	const active = draggingId !== null && !disabledIds.has(node.id);

	// Drop the local indicator as soon as the drag ends.
	useEffect(() => {
		if (draggingId === null) setZone(null);
	}, [draggingId]);

	const onPointerMove = (event: React.PointerEvent) => {
		if (!active) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const offset = event.clientY - rect.top;
		const next: FolderDropZone =
			offset < rect.height * 0.25
				? "before"
				: offset > rect.height * 0.75
					? "after"
					: "into";
		if (next !== zone) setZone(next);
		useFolderDragStore.getState().setTarget({ folderId: node.id, zone: next });
	};

	const onPointerLeave = () => {
		if (zone === null) return;
		setZone(null);
		const current = useFolderDragStore.getState().target;
		if (current?.folderId === node.id) {
			useFolderDragStore.getState().setTarget(null);
		}
	};

	return { zone: active ? zone : null, onPointerMove, onPointerLeave };
}
