/**
 * Sidebar tag section: colored-dot rows with usage counts. Click filters the
 * grid (view=tag); right-click manages (rename / color / delete).
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { SectionLabel } from "@/components/inspector/section";
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
import { RowCount, sidebarRowClass } from "./row";
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
		// `flex-auto`, not a fixed cap: the tag list and the folder tree share
		// whatever height is left in proportion to how much each has to show,
		// instead of the tags being stuck in 192px while space sits unused below.
		<div className="flex min-h-0 flex-auto flex-col">
			<div className="shrink-0 px-2 py-1">
				<SectionLabel>{T.sidebar.tagsTitle}</SectionLabel>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{tags.map((tag) => (
					<ContextMenu key={tag.id}>
						<ContextMenuTrigger className="block">
							<Link
								to="/"
								search={{ view: "tag", tagId: tag.id }}
								className={sidebarRowClass(activeTagId === tag.id)}
							>
								<TagDot color={tag.color} />
								<span className="min-w-0 flex-1 truncate">{tag.name}</span>
								<RowCount value={tag.asset_count} />
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
