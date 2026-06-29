import pino from "pino";

const isDev = import.meta.env.DEV;

/**
 * Shared frontend logger.
 *
 * Runs in the WebView, so output goes to the browser console as
 * structured objects. For persistent file logs, add the Tauri log
 * plugin (`pnpm tauri add log`) and bridge to it from a Rust command.
 *
 * Override the level with the `VITE_LOG_LEVEL` env var.
 */
export const logger = pino({
	level: import.meta.env.VITE_LOG_LEVEL ?? (isDev ? "debug" : "info"),
	browser: {
		asObject: true,
	},
});
