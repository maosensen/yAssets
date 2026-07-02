/**
 * Global route-level error boundary (router `defaultErrorComponent`).
 *
 * Replaces TanStack Router's built-in "Something went wrong!" screen, which
 * dead-ends the user. Always offers a way out: navigate home (+ reset the
 * boundary) or hard-reload the WebView.
 */

import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { CircleAlert, House, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import { T } from "@/lib/text";

export function AppErrorFallback({ error, reset }: ErrorComponentProps) {
	logger.error({ error }, "route error boundary hit");
	const router = useRouter();

	const goHome = () => {
		void router
			.navigate({ to: "/", search: { view: "all" }, replace: true })
			.catch(() => {
				// Navigation itself failed — the reload button remains.
			})
			.finally(() => reset());
	};

	const message =
		error instanceof Error ? error.message : String(error ?? "unknown");

	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
			<div className="flex flex-col items-center gap-2 text-center">
				<CircleAlert className="size-10 text-destructive" />
				<h1 className="font-semibold text-xl">{T.errorPage.title}</h1>
				<p className="max-w-md text-muted-foreground text-sm">
					{T.errorPage.hint}
				</p>
			</div>

			<div className="flex gap-3">
				<Button onClick={goHome}>
					<House className="size-4" />
					{T.errorPage.goHome}
				</Button>
				<Button variant="outline" onClick={() => window.location.reload()}>
					<RotateCw className="size-4" />
					{T.errorPage.reload}
				</Button>
			</div>

			<details className="w-full max-w-xl">
				<summary className="cursor-pointer text-muted-foreground text-xs">
					{T.errorPage.detailsLabel}
				</summary>
				<pre className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/50 p-3 text-xs">
					{message}
				</pre>
			</details>
		</main>
	);
}
