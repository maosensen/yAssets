import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";

/**
 * Typed wrapper around Tauri's `invoke`.
 *
 * - Centralizes IPC error logging so failures aren't swallowed
 * - Gives every call a return type via the generic
 *
 * Usage:
 *   const greeting = await invoke<string>("greet", { name });
 *
 * Prefer wrapping these in react-query (`useQuery` / `useMutation`)
 * rather than calling them ad-hoc in components.
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
