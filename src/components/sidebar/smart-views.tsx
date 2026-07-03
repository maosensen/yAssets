/**
 * The four smart views (all / uncategorized / recent / trash) with live
 * counters. Active state derives from the "/" route's search params; links
 * do a full search replace so switching views clears folder/search state.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import {
	IconAll,
	type IconComponent,
	IconRecent,
	IconTag,
	IconTrash,
	IconUncategorized,
} from "@/components/icons";
import { useDropTarget } from "@/hooks/use-drop-target";
import type { LibraryView } from "@/lib/library-view";
import { libraryStatsQueryOptions } from "@/lib/queries/library";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

type SmartView = LibraryView["view"];

export function SmartViews() {
	// Also rendered under /preview (same layout) — no throw, just no active view.
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const { data: stats } = useQuery(libraryStatsQueryOptions());

	const items: Array<{
		view: SmartView;
		label: string;
		icon: IconComponent;
		count: number | undefined;
	}> = [
		{ view: "all", label: T.sidebar.all, icon: IconAll, count: stats?.total },
		{
			view: "uncategorized",
			label: T.sidebar.uncategorized,
			icon: IconUncategorized,
			count: stats?.uncategorized,
		},
		{
			view: "untagged",
			label: T.sidebar.untagged,
			icon: IconTag,
			count: stats?.untagged,
		},
		{
			view: "recent",
			label: T.sidebar.recent,
			icon: IconRecent,
			count: undefined,
		},
		{
			view: "trash",
			label: T.sidebar.trash,
			icon: IconTrash,
			count: stats?.trash,
		},
	] as const;

	return (
		<nav className="flex flex-col gap-0.5">
			{items.map(({ view, label, icon: Icon, count }) => (
				<SmartViewRow
					key={view}
					view={view}
					label={label}
					Icon={Icon}
					count={count}
					active={search?.view === view}
				/>
			))}
		</nav>
	);
}

function SmartViewRow({
	view,
	label,
	Icon,
	count,
	active,
}: {
	view: SmartView;
	label: string;
	Icon: IconComponent;
	count: number | undefined;
	active: boolean;
}) {
	// Only the trash row is a drop target (drag assets here to soft-delete).
	const drop = useDropTarget({ kind: "trash" });
	const dropProps =
		view === "trash"
			? {
					onPointerEnter: drop.onPointerEnter,
					onPointerLeave: drop.onPointerLeave,
					onPointerUp: drop.onPointerUp,
				}
			: {};

	return (
		<Link
			to="/"
			search={{ view }}
			className={cn(
				"flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-sidebar-accent",
				active
					? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
					: "text-sidebar-foreground/80",
				view === "trash" && drop.isOver && "ring-2 ring-primary ring-inset",
			)}
			{...dropProps}
		>
			<Icon className="size-4 shrink-0" />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{count !== undefined && count > 0 && (
				<span className="text-muted-foreground text-xs tabular-nums">
					{count}
				</span>
			)}
		</Link>
	);
}
