/**
 * First-run / no-library-open screen: create a library, open one, or jump
 * back into a recent one. The `_library` layout guard redirects here whenever
 * no library is open.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import {
	IconClose,
	IconFolderAdd,
	IconFolderOpen,
	IconRecent,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useLibraryActions } from "@/hooks/use-library-actions";
import { describeError } from "@/lib/errors";
import { libraryKeys } from "@/lib/queries/keys";
import {
	recentLibrariesQueryOptions,
	removeRecentLibrary,
} from "@/lib/queries/library";
import { T } from "@/lib/text";

export const Route = createFileRoute("/welcome")({
	component: WelcomePage,
});

function WelcomePage() {
	const actions = useLibraryActions();

	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-10 p-8">
			<header className="flex flex-col items-center gap-2">
				<h1 className="font-semibold text-4xl tracking-tight">{T.app.name}</h1>
				<p className="text-muted-foreground">{T.welcome.tagline}</p>
			</header>

			<div className="flex gap-3">
				<Button
					size="lg"
					onClick={() => void actions.pickAndCreate()}
					disabled={actions.busy}
				>
					<IconFolderAdd className="size-4" />
					{T.welcome.createLibrary}
				</Button>
				<Button
					size="lg"
					variant="outline"
					onClick={() => void actions.pickAndOpen()}
					disabled={actions.busy}
				>
					<IconFolderOpen className="size-4" />
					{T.welcome.openLibrary}
				</Button>
			</div>

			<RecentList onOpen={actions.openPath} busy={actions.busy} />
		</main>
	);
}

function RecentList({
	onOpen,
	busy,
}: {
	onOpen: (path: string) => void;
	busy: boolean;
}) {
	const queryClient = useQueryClient();
	const { data: recents } = useQuery(recentLibrariesQueryOptions());

	const removeMutation = useMutation({
		mutationFn: removeRecentLibrary,
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: libraryKeys.recent }),
		onError: (error) => toast.error(describeError(error)),
	});

	return (
		<section className="w-full max-w-md">
			<h2 className="mb-2 flex items-center gap-1.5 text-muted-foreground text-sm">
				<IconRecent className="size-3.5" />
				{T.welcome.recentTitle}
			</h2>
			{!recents || recents.length === 0 ? (
				<EmptyState
					variant="panel"
					className="h-auto py-4"
					icon={IconRecent}
					title={T.welcome.recentEmpty}
					hint={T.welcome.recentEmptyHint}
				/>
			) : (
				<ul className="flex flex-col gap-1">
					{recents.map((entry) => (
						<li key={entry.path} className="group flex items-center gap-1">
							<button
								type="button"
								className="flex min-w-0 flex-1 flex-col rounded-md px-3 py-2 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
								disabled={busy || entry.missing}
								onClick={() => onOpen(entry.path)}
							>
								<span className="flex items-baseline gap-2">
									<span className="truncate font-medium text-sm">
										{entry.name}
									</span>
									{entry.missing && (
										<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
											{T.welcome.missingBadge}
										</span>
									)}
								</span>
								<span className="flex items-baseline justify-between gap-2">
									<span className="truncate text-muted-foreground text-xs">
										{entry.path}
									</span>
									<span className="shrink-0 text-muted-foreground text-xs">
										{format(
											// f64 exports as number|null (non-finite floats
											// serialize to null) — never actually null here.
											new Date(entry.last_opened_at ?? 0),
											"yyyy-MM-dd HH:mm",
										)}
									</span>
								</span>
							</button>
							<Button
								variant="ghost"
								size="icon"
								className="opacity-0 transition-opacity group-hover:opacity-100"
								aria-label={T.welcome.removeRecent}
								onClick={() => removeMutation.mutate(entry.path)}
							>
								<IconClose className="size-4" />
							</Button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
