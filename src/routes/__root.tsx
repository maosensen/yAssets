import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { useUpdateCheck } from "@/hooks/use-update-check";

/** Injected by `createRouter` in main.tsx; consumed by route guards. */
export type RouterContext = {
	queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootComponent,
});

function RootComponent() {
	// Startup update notification — root-level so the welcome screen gets it too.
	useUpdateCheck();
	return (
		<Providers>
			<Outlet />
			<Toaster position="bottom-right" />
		</Providers>
	);
}
