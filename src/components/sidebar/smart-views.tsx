/**
 * The four smart views (all / uncategorized / recent / trash) with live
 * counters. Active state derives from the "/" route's search params; links
 * do a full search replace so switching views clears folder/search state.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import {
	IconAll,
	IconAllBold,
	type IconComponent,
	IconRecent,
	IconRecentBold,
	IconTag,
	IconTagBold,
	IconTrash,
	IconTrashBold,
	IconUncategorized,
	IconUncategorizedBold,
} from "@/components/icons";
import { useDropTarget } from "@/hooks/use-drop-target";
import type { LibraryView } from "@/lib/library-view";
import { libraryStatsQueryOptions } from "@/lib/queries/library";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";

type SmartView = LibraryView["view"];

export function SmartViews() {
	// Also rendered under /preview (same layout) — no throw, just no active view.
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const { data: stats } = useQuery(libraryStatsQueryOptions());

	const items: Array<{
		view: SmartView;
		label: string;
		icon: IconComponent;
		iconBold: IconComponent;
		count: number | undefined;
	}> = [
		{
			view: "all",
			label: T.sidebar.all,
			icon: IconAll,
			iconBold: IconAllBold,
			count: stats?.total,
		},
		{
			view: "uncategorized",
			label: T.sidebar.uncategorized,
			icon: IconUncategorized,
			iconBold: IconUncategorizedBold,
			count: stats?.uncategorized,
		},
		{
			view: "untagged",
			label: T.sidebar.untagged,
			icon: IconTag,
			iconBold: IconTagBold,
			count: stats?.untagged,
		},
		{
			view: "recent",
			label: T.sidebar.recent,
			icon: IconRecent,
			iconBold: IconRecentBold,
			count: undefined,
		},
		{
			view: "trash",
			label: T.sidebar.trash,
			icon: IconTrash,
			iconBold: IconTrashBold,
			count: stats?.trash,
		},
	] as const;

	return (
		<nav className="flex flex-col gap-0.5">
			{items.map(({ view, label, icon: Icon, iconBold: IconBold, count }) => (
				<SmartViewRow
					key={view}
					view={view}
					label={label}
					Icon={Icon}
					IconBold={IconBold}
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
	IconBold,
	count,
	active,
}: {
	view: SmartView;
	label: string;
	Icon: IconComponent;
	IconBold: IconComponent;
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
			<NavIcon
				line={Icon}
				bold={IconBold}
				active={active}
				className="size-4 shrink-0"
			/>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{count !== undefined && count > 0 && (
				<span className="text-muted-foreground text-xs tabular-nums">
					{count}
				</span>
			)}
		</Link>
	);
}
