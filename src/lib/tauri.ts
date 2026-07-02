import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";

/**
 * Typed wrapper around Tauri's `invoke`.
 *
 * - Centralizes IPC error logging so failures aren't swallowed
 * - Gives every call a return type via the generic
 *
 * Usage:
 *   const info = await invoke<LibraryInfo>("open_library", { path });
 *
 * Prefer the generated typed `commands.*` from `@/lib/bindings` (plus
 * `unwrap` below) for commands, wrapped in react-query — this string-based
 * escape hatch remains for edge cases.
 */
export async function invoke<T>(
	cmd: string,
	args?: Record<string, unknown>,
): Promise<T> {
	try {
		return await tauriInvoke<T>(cmd, args);
	} catch (error) {
		logger.error({ cmd, args, error }, "tauri invoke failed");
		throw error;
	}
}

/**
 * Unwrap the `{ status: "ok" | "error" }` result shape produced by the
 * generated `commands.*` bindings for fallible (AppResult) commands.
 *
 * Throws the typed `AppError` payload so downstream `isCommandError` /
 * react-query `onError` handlers see the structured error, and logs it here
 * so IPC failures are never silently swallowed.
 *
 *   const info = unwrap(await commands.openLibrary(path));
 */
export function unwrap<T, E>(
	result: { status: "ok"; data: T } | { status: "error"; error: E },
): T {
	if (result.status === "error") {
		logger.error({ error: result.error }, "tauri command returned error");
		throw result.error;
	}
	return result.data;
}
