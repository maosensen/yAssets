/**
 * Interactive "Check for Updates" flow, shared by every entry point that
 * triggers it on demand: Preferences ▸ Updates, the library-switcher menu, and
 * the native app menu. `checkAndInstall` silently installs + relaunches when an
 * update exists; this wrapper adds the user-facing "already current" / "failed"
 * toasts so those surfaces don't each re-implement them.
 */

import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { T } from "@/lib/text";
import { checkAndInstall } from "@/lib/updater";

export async function runUpdateCheck(): Promise<void> {
	try {
		const outcome = await checkAndInstall();
		if (outcome === "none") toast.info(T.preferences.upToDate);
	} catch (error) {
		logger.warn({ error }, "update check failed");
		toast.error(T.preferences.updateFailed);
	}
}
