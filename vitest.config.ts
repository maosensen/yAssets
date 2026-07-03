/// <reference types="vitest/config" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vitest/config";

// Vitest config is kept separate from vite.config.ts so the TanStack Router
// plugin doesn't try to generate routes during test runs. Only the React
// plugin, the icon compiler and the `@` alias are needed here.
export default defineConfig({
	plugins: [react(), Icons({ compiler: "jsx", jsx: "react" })],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		css: false,
	},
});
