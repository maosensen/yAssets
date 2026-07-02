/**
 * Full-window highlight while a native OS drag hovers the window.
 * Pointer-events pass through — the drop is handled by the native
 * Tauri drag-drop event, not by this element.
 */

import { T } from "@/lib/text";

export function DropOverlay({ visible }: { visible: boolean }) {
	if (!visible) return null;
	return (
		<div className="pointer-events-none fixed inset-0 z-50 flex bg-background/80 p-6">
			<div className="flex flex-1 items-center justify-center rounded-2xl border-2 border-primary border-dashed">
				<p className="font-medium text-lg">{T.import.dropHint}</p>
			</div>
		</div>
	);
}
