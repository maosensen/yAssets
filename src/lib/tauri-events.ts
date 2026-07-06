/**
 * The single sanctioned wrapper around `@tauri-apps/api` event subscriptions
 * (same boundary rule as `tauri.ts` for invoke). Business events (import
 * progress etc.) use the typed `events.*` from `@/lib/bindings` instead —
 * this file only covers webview-level events that bindings don't model.
 *
 * Drag-drop MUST use the native Tauri event: the WebView's HTML5 drop
 * carries no real filesystem paths. Side effect of native drag-drop being
 * enabled: HTML5 DnD inside the page is unreliable (esp. WebView2), so
 * in-app dragging must use pointer events, never HTML5 drag.
 */

import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { logger } from "@/lib/logger";

export type DragDropHandlers = {
	onEnter?: (paths: string[]) => void;
	onLeave?: () => void;
	onDrop?: (paths: string[]) => void;
};

/** Subscribe to native OS drag-drop over the window. Returns unlisten. */
export async function subscribeDragDrop(
	handlers: DragDropHandlers,
): Promise<() => void> {
	const webview = getCurrentWebview();
	return webview.onDragDropEvent((event) => {
		switch (event.payload.type) {
			case "enter":
				handlers.onEnter?.(event.payload.paths);
				break;
			case "drop":
				logger.debug(
					{ count: event.payload.paths.length },
					"native drop received",
				);
				handlers.onDrop?.(event.payload.paths);
				break;
			case "leave":
				handlers.onLeave?.();
				break;
			default:
				// "over" — position only, no state change we care about.
				break;
		}
	});
}

/** Global actions the native app menu (macOS menu bar) dispatches into the
 *  webview. The Rust side emits `menu://<action>` on click (see lib.rs). */
export type MenuAction = "preferences" | "about" | "check-updates";

const MENU_ACTIONS: readonly MenuAction[] = [
	"preferences",
	"about",
	"check-updates",
];

/** Subscribe to native-menu actions. Returns unlisten. */
export async function subscribeMenu(
	handler: (action: MenuAction) => void,
): Promise<() => void> {
	const unlisteners = await Promise.all(
		MENU_ACTIONS.map((action) =>
			listen(`menu://${action}`, () => handler(action)),
		),
	);
	return () => {
		for (const unlisten of unlisteners) unlisten();
	};
}
