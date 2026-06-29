import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @tauri-apps/cli sets TAURI_DEV_HOST when running mobile dev.
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		// Router plugin must run before the React plugin.
		tanstackRouter({ target: "react", autoCodeSplitting: true }),
		react(),
		tailwindcss(),
	],

	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},

	// --- Tauri-specific settings (do not remove) ---
	// Prevent Vite from clobbering Rust compiler errors in the terminal.
	clearScreen: false,
	server: {
		// Tauri expects a fixed port; fail if it is taken.
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
		watch: {
			// Rust recompiles handle src-tauri; don't let Vite watch it.
			ignored: ["**/src-tauri/**"],
		},
	},
	// Expose VITE_* to the frontend and TAURI_ENV_* for build-time targeting.
	envPrefix: ["VITE_", "TAURI_ENV_*"],
});
