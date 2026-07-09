/**
 * Thin wrapper over plugin-opener (mirrors `lib/dialogs.ts`) — the only
 * place the frontend launches external URLs. Failures log, never throw.
 */

import { openUrl as pluginOpenUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/lib/bindings";
import { logger } from "@/lib/logger";

export async function openExternalUrl(url: string): Promise<void> {
	try {
		await pluginOpenUrl(url);
	} catch (error) {
		logger.warn({ url, error }, "failed to open external url");
	}
}

/**
 * Open a link asset's page in the in-app browser window (a live Tauri webview,
 * not an iframe — so sites that forbid framing still render). Reuses one window
 * across links. Falls back to the system browser on failure.
 */
export async function openLinkWindow(
	url: string,
	title?: string | null,
): Promise<void> {
	const result = await commands.openLinkWindow(url, title ?? null);
	if (result.status === "error") {
		logger.warn({ url, error: result.error }, "in-app link view failed");
		await openExternalUrl(url);
	}
}
