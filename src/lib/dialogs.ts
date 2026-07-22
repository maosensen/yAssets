/**
 * Thin wrappers around `@tauri-apps/plugin-dialog` — the only place the
 * dialog plugin is imported (same boundary rule as `tauri.ts` for invoke).
 */

import { open } from "@tauri-apps/plugin-dialog";

/** Native directory picker; `null` when the user cancels. */
export async function pickDirectory(title?: string): Promise<string | null> {
	const result = await open({ directory: true, multiple: false, title });
	return typeof result === "string" ? result : null;
}

/** Native multi-file picker; empty array when the user cancels. */
export async function pickFiles(title?: string): Promise<string[]> {
	const result = await open({ multiple: true, title });
	if (Array.isArray(result)) return result;
	return typeof result === "string" ? [result] : [];
}

/** Native single-image picker; `null` when the user cancels. */
export async function pickImageFile(title?: string): Promise<string | null> {
	const result = await open({
		multiple: false,
		title,
		filters: [
			{
				name: "Image",
				extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"],
			},
		],
	});
	return typeof result === "string" ? result : null;
}
