/**
 * Native drag-drop → import trigger. Mount once (AppShell).
 *
 * StrictMode-safe subscription: the effect may run twice; the `disposed`
 * flag makes sure a late-resolving listen from a dead effect is immediately
 * unlistened. The drop callback goes through a ref so re-renders never
 * resubscribe.
 */

import { useEffect, useRef, useState } from "react";
import { subscribeDragDrop } from "@/lib/tauri-events";

export function useDragImport(onDrop: (paths: string[]) => void) {
	const [isDragOver, setDragOver] = useState(false);
	const onDropRef = useRef(onDrop);
	onDropRef.current = onDrop;

	useEffect(() => {
		let disposed = false;
		let unlisten: (() => void) | undefined;
		void subscribeDragDrop({
			onEnter: () => setDragOver(true),
			onLeave: () => setDragOver(false),
			onDrop: (paths) => {
				setDragOver(false);
				if (paths.length > 0) onDropRef.current(paths);
			},
		}).then((fn) => {
			if (disposed) {
				fn();
				return;
			}
			unlisten = fn;
		});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, []);

	return { isDragOver };
}
