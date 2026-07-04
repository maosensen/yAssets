/**
 * Thin wrapper over plugin-opener (mirrors `lib/dialogs.ts`) — the only
 * place the frontend launches external URLs. Failures log, never throw.
 */

import { openUrl as pluginOpenUrl } from "@tauri-apps/plugin-opener";
import { logger } from "@/lib/logger";

export async function openExternalUrl(url: string): Promise<void> {
	try {
		await pluginOpenUrl(url);
	} catch (error) {
		logger.warn({ url, error }, "failed to open external url");
	}
}
