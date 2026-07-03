/**
 * Sidebar tag section: colored-dot rows with usage counts. Click filters the
 * grid (view=tag); right-click manages (rename / color / delete).
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Tag } from "@/lib/bindings";
import { tagsQueryOptions, useDeleteTag } from "@/lib/queries/tags";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";
import { TagEditDialog } from "./tag-edit-dialog";

export function TagList() {
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const { data: tags } = useQuery(tagsQueryOptions());
	const [editing, setEditing] = useState<Tag | null>(null);
	const [deleting, setDeleting] = useState<Tag | null>(null);
	const deleteMutation = useDeleteTag();

	if (!tags || tags.length === 0) return null;

	const activeTagId = search?.view === "tag" ? (search.tagId ?? null) : null;

	return (
		<div className="flex min-h-0 shrink-0 flex-col">
			<div className="px-2 py-1 text-muted-foreground text-xs">
				{T.sidebar.tagsTitle}
			</div>
			<div className="max-h-48 overflow-y-auto">
				{tags.map((tag) => (
					<ContextMenu key={tag.id}>
						<ContextMenuTrigger className="block">
							<Link
								to="/"
								search={{ view: "tag", tagId: tag.id }}
								className={cn(
									"flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-sidebar-accent",
									activeTagId === tag.id
										? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
										: "text-sidebar-foreground/80",
								)}
							>
								<TagDot color={tag.color} />
								<span className="min-w-0 flex-1 truncate">{tag.name}</span>
								{tag.asset_count > 0 && (
									<span className="text-muted-foreground text-xs tabular-nums">
										{tag.asset_count}
									</span>
								)}
							</Link>
						</ContextMenuTrigger>
						<ContextMenuContent>
							<ContextMenuItem onClick={() => setEditing(tag)}>
								{T.tags.rename}
							</ContextMenuItem>
							<ContextMenuSeparator />
							<ContextMenuItem onClick={() => setDeleting(tag)}>
								<span className="text-destructive">{T.tags.delete}</span>
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				))}
			</div>

			<TagEditDialog tag={editing} onClose={() => setEditing(null)} />

			<AlertDialog
				open={deleting !== null}
				onOpenChange={(open) => !open && setDeleting(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{deleting ? T.tags.deleteTitle(deleting.name) : ""}
						</AlertDialogTitle>
						<AlertDialogDescription>{T.tags.deleteDesc}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{T.common.cancel}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deleting) deleteMutation.mutate(deleting.id);
								setDeleting(null);
							}}
						>
							{T.tags.deleteAction}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

export function TagDot({ color }: { color: string | null }) {
	return (
		<span
			className="size-2.5 shrink-0 rounded-full border border-foreground/10"
			style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
		/>
	);
}
