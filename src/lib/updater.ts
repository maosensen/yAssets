/**
 * Self-update flow (mirrors the lib/dialogs.ts wrapper convention) — the
 * only place the frontend touches plugin-updater/plugin-process.
 *
 * Two consumers:
 * - startup notification (use-update-check): `checkForUpdate` → toast with
 *   an install action → `installAndRelaunch`
 * - Preferences ▸ Check for Updates: `checkAndInstall` does the whole run
 *
 * Errors bubble to callers — in dev builds the endpoint/signature check
 * failing is expected.
 */

import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { logger } from "@/lib/logger";

export type { Update };

/** Ask the release endpoint; `null` = already current. */
export async function checkForUpdate(): Promise<Update | null> {
	return await check();
}

/** Download, install and restart into the new version. */
export async function installAndRelaunch(
	update: Update,
	onProgress?: (downloaded: number, total: number | undefined) => void,
): Promise<void> {
	logger.info(
		{ version: update.version, current: update.currentVersion },
		"installing update",
	);
	let downloaded = 0;
	let total: number | undefined;
	await update.downloadAndInstall((event) => {
		switch (event.event) {
			case "Started":
				total = event.data.contentLength ?? undefined;
				break;
			case "Progress":
				downloaded += event.data.chunkLength;
				onProgress?.(downloaded, total);
				break;
			default:
				break;
		}
	});
	await relaunch();
}

export type UpdateOutcome = "none" | "installed";

/** One-shot manual path (Preferences): check → install → relaunch. */
export async function checkAndInstall(
	onProgress?: (downloaded: number, total: number | undefined) => void,
): Promise<UpdateOutcome> {
	const update = await checkForUpdate();
	if (!update) return "none";
	await installAndRelaunch(update, onProgress);
	return "installed";
}
