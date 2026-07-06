import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { I18nProvider } from "@/components/i18n-provider";
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
			{/* Only the routed content remounts on a language switch (so every
			    component re-reads T). The Toaster stays mounted OUTSIDE the boundary
			    — remounting it would wipe active toasts, incl. the persistent
			    update-available toast that only fires once per launch. */}
			<I18nProvider>
				<Outlet />
			</I18nProvider>
			<Toaster position="bottom-right" />
		</Providers>
	);
}
