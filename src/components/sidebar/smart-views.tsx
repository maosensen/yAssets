/**
 * The four smart views (all / uncategorized / recent / trash) with live
 * counters. Active state derives from the "/" route's search params; links
 * do a full search replace so switching views clears folder/search state.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Clock, Images, Inbox, Trash2 } from "lucide-react";
import { libraryStatsQueryOptions } from "@/lib/queries/library";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

export function SmartViews() {
	const search = useSearch({ from: "/_library/" });
	const { data: stats } = useQuery(libraryStatsQueryOptions());

	const items = [
		{ view: "all", label: T.sidebar.all, icon: Images, count: stats?.total },
		{
			view: "uncategorized",
			label: T.sidebar.uncategorized,
			icon: Inbox,
			count: stats?.uncategorized,
		},
		{
			view: "recent",
			label: T.sidebar.recent,
			icon: Clock,
			count: undefined,
		},
		{
			view: "trash",
			label: T.sidebar.trash,
			icon: Trash2,
			count: stats?.trash,
		},
	] as const;

	return (
		<nav className="flex flex-col gap-0.5">
			{items.map(({ view, label, icon: Icon, count }) => (
				<Link
					key={view}
					to="/"
					search={{ view }}
					className={cn(
						"flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
						search.view === view
							? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
							: "text-sidebar-foreground/80",
					)}
				>
					<Icon className="size-4 shrink-0" />
					<span className="min-w-0 flex-1 truncate">{label}</span>
					{count !== undefined && count > 0 && (
						<span className="text-muted-foreground text-xs tabular-nums">
							{count}
						</span>
					)}
				</Link>
			))}
		</nav>
	);
}
