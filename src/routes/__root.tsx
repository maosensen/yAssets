import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

/** Injected by `createRouter` in main.tsx; consumed by route guards. */
export type RouterContext = {
	queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootComponent,
});

function RootComponent() {
	return (
		<Providers>
			<Outlet />
			<Toaster position="bottom-right" />
		</Providers>
	);
}
