/**
 * Inspector layout primitives: a shared micro-caps section label and the
 * dashed divider separating major modules — one visual rhythm for the whole
 * right pane (and reused by the batch panel / tag picker).
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionLabel({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"font-medium text-[11px] text-muted-foreground/80 uppercase tracking-wider",
				className,
			)}
		>
			{children}
		</span>
	);
}

/** Dashed divider between major inspector modules. */
export function DashedDivider({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={cn("my-4 border-border/60 border-t border-dashed", className)}
		/>
	);
}
