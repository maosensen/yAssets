/**
 * Self-update flow (mirrors the lib/dialogs.ts wrapper convention) — the
 * only place the frontend touches plugin-updater/plugin-process.
 *
 * `checkAndInstall` resolves "none" when already current; when an update
 * exists it downloads, installs and relaunches (so the "installed" return
 * is practically unreachable). Errors bubble to the caller for a toast —
 * in dev builds the endpoint/signature check failing is expected.
 */

import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { logger } from "@/lib/logger";

export type UpdateOutcome = "none" | "installed";

export async function checkAndInstall(
	onProgress?: (downloaded: number, total: number | undefined) => void,
): Promise<UpdateOutcome> {
	const update = await check();
	if (!update) return "none";

	logger.info(
		{ version: update.version, current: update.currentVersion },
		"update available — downloading",
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
	return "installed";
}
