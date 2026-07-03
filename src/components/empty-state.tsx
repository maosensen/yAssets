/**
 * Unified empty / no-data / error placeholder — ONE visual language for every
 * "nothing here" moment (empty views, no results, no selection, error pages).
 *
 * Anatomy: soft icon tile (dashed ring) → title → optional meta/hint →
 * optional actions. `variant="page"` fills a content pane; `variant="panel"`
 * is the compact form for narrow columns (inspector, side lists).
 */

import type { ReactNode } from "react";
import type { IconComponent } from "@/components/icons";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
	icon: IconComponent;
	title: string;
	/** Supporting line under the title. */
	hint?: string;
	/** Small data line between title and hint (e.g. item counts). */
	meta?: string;
	/** Action buttons rendered under the text block. */
	children?: ReactNode;
	variant?: "page" | "panel";
	/** `destructive` tints the icon tile for error placeholders. */
	tone?: "default" | "destructive";
	className?: string;
};

export function EmptyState({
	icon: Icon,
	title,
	hint,
	meta,
	children,
	variant = "page",
	tone = "default",
	className,
}: EmptyStateProps) {
	const page = variant === "page";
	return (
		<div
			className={cn(
				"flex h-full flex-col items-center justify-center text-center",
				page ? "gap-4 p-8" : "gap-3 p-4",
				className,
			)}
		>
			<div
				className={cn(
					"flex items-center justify-center border border-dashed",
					page ? "size-16 rounded-lg" : "size-12 rounded-md",
					tone === "destructive"
						? "border-destructive/30 bg-destructive/10 text-destructive"
						: "border-border/70 bg-muted/40 text-muted-foreground/70",
				)}
			>
				<Icon className={page ? "size-7" : "size-5"} />
			</div>
			<div className={cn("flex flex-col", page ? "gap-1.5" : "gap-1")}>
				<p className={cn("font-semibold", page ? "text-base" : "text-sm")}>
					{title}
				</p>
				{meta && (
					<p className="text-muted-foreground text-xs tabular-nums">{meta}</p>
				)}
				{hint && (
					<p
						className={cn(
							"mx-auto max-w-sm text-muted-foreground leading-relaxed",
							page ? "text-sm" : "text-xs",
						)}
					>
						{hint}
					</p>
				)}
			</div>
			{children && (
				<div className={cn("flex items-center gap-3", page ? "mt-2" : "mt-1")}>
					{children}
				</div>
			)}
		</div>
	);
}
