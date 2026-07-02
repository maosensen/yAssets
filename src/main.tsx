import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { AppErrorFallback } from "@/components/app-error-fallback";
import { getQueryClient } from "@/lib/query-client";
import { routeTree } from "./routeTree.gen";
import "./index.css";

// Created automatically by @tanstack/router-plugin on first dev/build.
// The queryClient rides along in router context so route guards
// (`beforeLoad`) can consult the cache without extra IPC.
const router = createRouter({
	routeTree,
	context: { queryClient: getQueryClient() },
	// Never dead-end the user on a crash — always offer a way home.
	defaultErrorComponent: AppErrorFallback,
});

// Type-safe router registration.
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
