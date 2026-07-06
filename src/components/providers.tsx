import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { getQueryClient } from "@/lib/query-client";

export function Providers({ children }: { children: ReactNode }) {
	const queryClient = getQueryClient();

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider defaultTheme="dark" storageKey="yassets-theme">
				{children}
			</ThemeProvider>
		</QueryClientProvider>
	);
}
