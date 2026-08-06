/**
 * The single definition of a sidebar row's geometry.
 *
 * Five lists render rows — smart views, Discover, smart folders, folders, tags —
 * and each used to spell out its own padding, gap and active state. They
 * drifted: folder rows ended up sitting further right than tag rows, and their
 * counts sat close enough to the edge that the macOS overlay scrollbar covered
 * the digits. Both are geometry decisions, so they live here once.
 *
 * `pr-3` is the important number: it is the gutter that keeps a count clear of
 * an overlay scrollbar. `scrollbar-gutter: stable` cannot do this job — in
 * overlay mode the scrollbar has no layout width to reserve — so the inset has
 * to be real padding, and it has to be on every row or the count columns stop
 * lining up between sections.
 */

import type { ClassValue } from "clsx";
import { cn } from "@/lib/utils";

/** Left inset of a row's glyph. Rows in the folder tree add a chevron slot. */
export const SIDEBAR_ROW_BASE =
	"flex items-center gap-2 rounded-md py-1 pr-3 pl-2 text-sm";

export function sidebarRowClass(active: boolean, className?: ClassValue) {
	return cn(
		SIDEBAR_ROW_BASE,
		"hover:bg-sidebar-accent",
		active
			? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
			: "text-sidebar-foreground/80",
		className,
	);
}

/**
 * A row's trailing count. Fixed minimum width so single- and triple-digit
 * counts share a left edge instead of stepping in and out down the column;
 * absent (rather than "0") when there is nothing to count.
 */
export function RowCount({ value }: { value: number | null | undefined }) {
	if (value === null || value === undefined || value <= 0) return null;
	return (
		<span className="min-w-6 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
			{value}
		</span>
	);
}
