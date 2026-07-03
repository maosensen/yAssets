/**
 * Floating drag ghost following the pointer during an in-app card drag.
 * Mounted once in AppShell; renders nothing when no drag is active.
 */

import { useEffect, useState } from "react";
import { useDragStore } from "@/lib/stores/drag-store";
import { T } from "@/lib/text";

export function DragGhost() {
	const draggingIds = useDragStore((state) => state.draggingIds);
	const [pointer, setPointer] = useState({ x: 0, y: 0 });

	// Subscribe imperatively so pointer moves don't re-render via React state
	// churn on every mousemove for the whole tree — only this component.
	useEffect(
		() =>
			useDragStore.subscribe((state) => {
				setPointer(state.pointer);
			}),
		[],
	);

	if (draggingIds.length === 0) return null;

	return (
		<div
			className="pointer-events-none fixed z-[100] flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground text-xs shadow-lg"
			style={{ left: pointer.x + 12, top: pointer.y + 12 }}
		>
			{T.drag.count(draggingIds.length)}
		</div>
	);
}
