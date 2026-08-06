/**
 * Sidebar entry for the Discover route (browse third-party sources). A plain
 * route link — active when the /discover route is showing.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { IconDiscover, IconDiscoverBold } from "@/components/icons";
import { T } from "@/lib/text";
import { NavIcon } from "./nav-icon";
import { sidebarRowClass } from "./row";

export function DiscoverNav() {
	const active = useRouterState({
		select: (state) => state.location.pathname === "/discover",
	});

	return (
		<Link to="/discover" className={sidebarRowClass(active)}>
			<NavIcon
				line={IconDiscover}
				bold={IconDiscoverBold}
				active={active}
				className="size-4 shrink-0"
			/>
			<span className="min-w-0 flex-1 truncate">{T.discover.title}</span>
		</Link>
	);
}
