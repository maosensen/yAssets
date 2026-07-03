/**
 * Window drag + maximize gestures for chrome regions (column headers, the
 * whole sidebar).
 *
 * `data-tauri-drag-region` only reacts on the exact element it's set on
 * (children excluded) and offers no long-press affordance, so chrome regions
 * use this hook instead:
 *
 * - empty area: press + move (>3px) OR hold 200ms → native `startDragging`
 * - interactive child (button/link/input/…): hold 400ms *without moving* →
 *   drag; any earlier movement/release falls through to the normal control
 * - double-click on an empty area → `toggleMaximize` (native zoom animation)
 *
 * Once the OS drag session starts the WebView stops receiving pointer events,
 * so the pending click on a held control never fires — no ghost clicks.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { logger } from "@/lib/logger";

const INTERACTIVE =
	"button, a, input, textarea, select, [role='button'], [role='menuitem'], [role='slider'], [contenteditable='true'], [data-no-window-drag]";

const MOVE_THRESHOLD_PX = 3;
const EMPTY_HOLD_MS = 200;
const INTERACTIVE_HOLD_MS = 400;

export function useWindowDrag() {
	const cleanupRef = useRef<(() => void) | null>(null);

	// Don't leak the window listeners if the region unmounts mid-gesture.
	useEffect(() => () => cleanupRef.current?.(), []);

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLElement>) => {
			// Primary button only; let dblclick (detail 2) reach onDoubleClick.
			if (event.button !== 0 || event.detail > 1) return;
			const target = event.target as HTMLElement;
			const interactive = target.closest(INTERACTIVE) !== null;
			// Suppress text selection while holding empty chrome.
			if (!interactive) event.preventDefault();

			const startX = event.clientX;
			const startY = event.clientY;
			cleanupRef.current?.();

			const cleanup = () => {
				window.clearTimeout(timer);
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", cleanup);
				window.removeEventListener("pointercancel", cleanup);
				cleanupRef.current = null;
			};
			const beginDrag = () => {
				cleanup();
				getCurrentWindow()
					.startDragging()
					.catch((error) =>
						logger.warn({ error }, "window startDragging failed"),
					);
			};
			const onMove = (e: PointerEvent) => {
				const moved =
					Math.hypot(e.clientX - startX, e.clientY - startY) >
					MOVE_THRESHOLD_PX;
				if (!moved) return;
				// Moving off an interactive control means the user is using the
				// control (or just slipping) — cancel the pending window drag.
				if (interactive) cleanup();
				else beginDrag();
			};
			const timer = window.setTimeout(
				beginDrag,
				interactive ? INTERACTIVE_HOLD_MS : EMPTY_HOLD_MS,
			);

			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", cleanup);
			window.addEventListener("pointercancel", cleanup);
			cleanupRef.current = cleanup;
		},
		[],
	);

	const onDoubleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
		const target = event.target as HTMLElement;
		if (target.closest(INTERACTIVE)) return;
		getCurrentWindow()
			.toggleMaximize()
			.catch((error) => logger.warn({ error }, "toggleMaximize failed"));
	}, []);

	return { onPointerDown, onDoubleClick };
}
