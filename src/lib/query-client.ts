import { QueryClient } from "@tanstack/react-query";

let client: QueryClient | undefined;

/**
 * Single shared QueryClient for the app's lifetime.
 *
 * No SSR concerns here (Tauri is always a browser/WebView context),
 * so one lazily-created singleton is all we need.
 */
export function getQueryClient() {
	if (!client) {
		client = new QueryClient({
			defaultOptions: {
				queries: {
					staleTime: 60 * 1000,
					refetchOnWindowFocus: false,
					retry: 1,
				},
			},
		});
	}
	return client;
}
