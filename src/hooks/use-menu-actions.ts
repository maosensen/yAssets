/**
 * Bridges native app-menu clicks (the macOS menu bar built in lib.rs) to the
 * same in-app actions the sidebar menu exposes. Mounted once at the root, above
 * the locale remount boundary, so the subscription isn't torn down on a
 * language switch.
 */

import { useEffect } from "react";
import { useUiStore } from "@/lib/stores/ui-store";
import { subscribeMenu } from "@/lib/tauri-events";
import { runUpdateCheck } from "@/lib/update-actions";

export function useMenuActions() {
	useEffect(() => {
		let dispose: (() => void) | undefined;
		// If the effect is torn down before subscribeMenu resolves (StrictMode
		// double-mount, fast unmount), unlisten as soon as it does — otherwise the
		// listener leaks and menu clicks fire twice.
		let cancelled = false;
		void subscribeMenu((action) => {
			const ui = useUiStore.getState();
			switch (action) {
				case "preferences":
					ui.setPreferencesOpen(true);
					break;
				case "about":
					ui.setAboutOpen(true);
					break;
				case "check-updates":
					void runUpdateCheck();
					break;
			}
		}).then((unlisten) => {
			if (cancelled) unlisten();
			else dispose = unlisten;
		});
		return () => {
			cancelled = true;
			dispose?.();
		};
	}, []);
}
