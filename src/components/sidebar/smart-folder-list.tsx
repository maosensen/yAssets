/**
 * Sidebar "Smart Folders" section: saved rule sets as live views. Click
 * filters the grid (view=smart); right-click edits/deletes; the header "+"
 * creates. Always visible (it's the only creation entry point).
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import {
	IconAdd,
	IconMagic,
	IconSmartFolderBold,
	IconWarning,
} from "@/components/icons";
import { SectionLabel } from "@/components/inspector/section";
import { NavIcon } from "@/components/sidebar/nav-icon";
import {
	SmartFolderDialog,
	type SmartFolderDialogState,
} from "@/components/sidebar/smart-folder-dialog";
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
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { SmartFolder } from "@/lib/bindings";
import {
	smartFoldersQueryOptions,
	useDeleteSmartFolder,
} from "@/lib/queries/smart-folders";
import { T } from "@/lib/text";
import { sidebarRowClass } from "./row";

export function SmartFolderList() {
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const { data: folders } = useQuery(smartFoldersQueryOptions());
	const [dialog, setDialog] = useState<SmartFolderDialogState>(null);
	const [deleting, setDeleting] = useState<SmartFolder | null>(null);
	const deleteMutation = useDeleteSmartFolder();

	const activeId = search?.view === "smart" ? (search.smartId ?? null) : null;

	return (
		<div className="flex shrink-0 flex-col">
			<div className="flex items-center justify-between py-1 pr-1 pl-2">
				<SectionLabel>{T.smartFolders.title}</SectionLabel>
				<Button
					variant="ghost"
					size="icon"
					className="size-6 text-muted-foreground"
					aria-label={T.smartFolders.create}
					onClick={() => setDialog("new")}
				>
					<IconAdd className="size-4" />
				</Button>
			</div>

			{(folders ?? []).map((folder) =>
				// `rules: null` = saved by a newer build than this one. Shown, but
				// not navigable (there is no rule set to run) and not editable
				// (saving would overwrite conditions we could not read). Delete
				// stays available so the row isn't a dead end.
				folder.rules === null ? (
					<ContextMenu key={folder.id}>
						<ContextMenuTrigger className="block">
							<div
								className={sidebarRowClass(false, "cursor-default opacity-60")}
								title={T.smartFolders.unreadableHint}
							>
								<IconWarning className="size-4 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{folder.name}</span>
							</div>
						</ContextMenuTrigger>
						<ContextMenuContent>
							<ContextMenuItem disabled>
								{T.smartFolders.unreadableLabel}
							</ContextMenuItem>
							<ContextMenuSeparator />
							<ContextMenuItem onClick={() => setDeleting(folder)}>
								<span className="text-destructive">
									{T.smartFolders.menuDelete}
								</span>
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				) : (
					<ContextMenu key={folder.id}>
						<ContextMenuTrigger className="block">
							<Link
								to="/"
								search={{ view: "smart", smartId: folder.id }}
								className={sidebarRowClass(activeId === folder.id)}
							>
								<NavIcon
									line={IconMagic}
									bold={IconSmartFolderBold}
									active={activeId === folder.id}
									className="size-4 shrink-0"
								/>
								<span className="min-w-0 flex-1 truncate">{folder.name}</span>
							</Link>
						</ContextMenuTrigger>
						<ContextMenuContent>
							<ContextMenuItem onClick={() => setDialog(folder)}>
								{T.smartFolders.menuEdit}
							</ContextMenuItem>
							<ContextMenuSeparator />
							<ContextMenuItem onClick={() => setDeleting(folder)}>
								<span className="text-destructive">
									{T.smartFolders.menuDelete}
								</span>
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				),
			)}

			<SmartFolderDialog state={dialog} onClose={() => setDialog(null)} />

			<AlertDialog
				open={deleting !== null}
				onOpenChange={(open) => !open && setDeleting(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{deleting ? T.smartFolders.deleteTitle(deleting.name) : ""}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{T.smartFolders.deleteDesc}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{T.common.cancel}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deleting) deleteMutation.mutate(deleting.id);
								setDeleting(null);
							}}
						>
							{T.smartFolders.deleteAction}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
