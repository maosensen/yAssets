/**
 * App-global dialogs reachable from any screen — including the welcome screen,
 * where there's no sidebar — and from the native menu bar. Rendered once inside
 * the locale-remount boundary (so they re-translate on a language switch) and
 * driven by the UI store (so a menu click opens them regardless of route).
 */

import { AboutDialog } from "@/components/about-dialog";
import { ChangelogDialog } from "@/components/changelog-dialog";
import { PreferencesDialog } from "@/components/preferences/preferences-dialog";
import { useUiStore } from "@/lib/stores/ui-store";

export function AppDialogs() {
	const prefsOpen = useUiStore((state) => state.preferencesOpen);
	const setPrefsOpen = useUiStore((state) => state.setPreferencesOpen);
	return (
		<>
			<PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
			<AboutDialog />
			<ChangelogDialog />
		</>
	);
}
