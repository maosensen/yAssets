/**
 * Sidebar entry for the Discover route (browse third-party sources). A plain
 * route link — active when the /discover route is showing.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { IconDiscover } from "@/components/icons";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

export function DiscoverNav() {
	const active = useRouterState({
		select: (state) => state.location.pathname === "/discover",
	});

	return (
		<Link
			to="/discover"
			className={cn(
				"flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-sidebar-accent",
				active
					? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
					: "text-sidebar-foreground/80",
			)}
		>
			<IconDiscover className="size-4 shrink-0" />
			<span className="min-w-0 flex-1 truncate">{T.discover.title}</span>
		</Link>
	);
}
