/**
 * Floating ghost following the pointer while a sidebar folder is dragged.
 * Mounted once in the folder tree; renders nothing when no folder drag runs.
 */

import { useEffect, useState } from "react";
import { IconFolder } from "@/components/icons";
import { useFolderDragStore } from "@/lib/stores/folder-drag-store";

export function FolderDragGhost() {
	const draggingName = useFolderDragStore((state) => state.draggingName);
	const [pointer, setPointer] = useState({ x: 0, y: 0 });

	// Subscribe imperatively so pointer moves don't re-render the whole tree.
	useEffect(
		() =>
			useFolderDragStore.subscribe((state) => {
				setPointer(state.pointer);
			}),
		[],
	);

	if (draggingName === null) return null;

	return (
		<div
			className="pointer-events-none fixed z-[100] flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground text-xs shadow-lg"
			style={{ left: pointer.x + 12, top: pointer.y + 12 }}
		>
			<IconFolder className="size-3.5" />
			<span className="max-w-40 truncate">{draggingName}</span>
		</div>
	);
}
