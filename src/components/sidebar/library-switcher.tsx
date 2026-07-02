/**
 * Current-library dropdown at the top of the sidebar: recent libraries,
 * open-other, create-new, close-current — Eagle's top-left switcher.
 */

import { useQuery } from "@tanstack/react-query";
import {
	ChevronsUpDown,
	FolderOpen,
	FolderPlus,
	Library,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLibraryActions } from "@/hooks/use-library-actions";
import {
	currentLibraryQueryOptions,
	recentLibrariesQueryOptions,
} from "@/lib/queries/library";
import { T } from "@/lib/text";

export function LibrarySwitcher() {
	const { data: library } = useQuery(currentLibraryQueryOptions());
	const { data: recents } = useQuery(recentLibrariesQueryOptions());
	const actions = useLibraryActions();

	const otherRecents = (recents ?? []).filter(
		(entry) => entry.path !== library?.path,
	);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						className="w-full justify-start gap-2 px-2"
						disabled={actions.busy}
					/>
				}
			>
				<Library className="size-4 shrink-0" />
				<span className="min-w-0 flex-1 truncate text-left font-medium">
					{library?.name ?? T.app.name}
				</span>
				<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				{otherRecents.length > 0 && (
					<>
						{/* Base UI hard-requires GroupLabel to live inside a Group —
						    a bare label throws MenuGroupContext at runtime. */}
						<DropdownMenuGroup>
							<DropdownMenuLabel>
								{T.sidebar.switcher.recentGroup}
							</DropdownMenuLabel>
							{otherRecents.map((entry) => (
								<DropdownMenuItem
									key={entry.path}
									disabled={entry.missing}
									onClick={() => actions.openPath(entry.path)}
								>
									<span className="min-w-0 flex-1 truncate">{entry.name}</span>
									{entry.missing && (
										<span className="text-muted-foreground text-xs">
											{T.welcome.missingBadge}
										</span>
									)}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuItem onClick={() => void actions.pickAndOpen()}>
					<FolderOpen className="size-4" />
					{T.sidebar.switcher.openOther}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => void actions.pickAndCreate()}>
					<FolderPlus className="size-4" />
					{T.sidebar.switcher.createNew}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => actions.closeCurrent()}>
					<X className="size-4" />
					{T.sidebar.switcher.closeCurrent}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
