/**
 * The sidebar folder tree: header (+ new-folder), recursive rows, and the
 * shared name/delete dialogs. Data is the flat `list_folders` result,
 * assembled and filtered by the pure helpers in `lib/folder-tree.ts`.
 * Folder counts are in the hundreds at most — no virtualization.
 */

import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { IconPlus } from "@/components/icons";
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
import { Button } from "@/components/ui/button";
import {
	buildFolderTree,
	type FolderNode,
	filterFolderTree,
} from "@/lib/folder-tree";
import { foldersQueryOptions, useDeleteFolder } from "@/lib/queries/folders";
import { T } from "@/lib/text";
import { type FolderDialogState, FolderNameDialog } from "./folder-name-dialog";
import { FolderTreeItem } from "./folder-tree-item";

export function FolderTree({ filter }: { filter: string }) {
	// Also rendered under /preview (same layout) — no throw, no active folder.
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const { data: folders } = useQuery(foldersQueryOptions());
	const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [dialog, setDialog] = useState<FolderDialogState | null>(null);
	const [deleting, setDeleting] = useState<FolderNode | null>(null);
	const deleteMutation = useDeleteFolder();

	const filtering = filter.trim().length > 0;
	const tree = useMemo(
		() => filterFolderTree(buildFolderTree(folders ?? []), filter),
		[folders, filter],
	);

	const toggle = (id: string) =>
		setExpandedIds((previous) => {
			const next = new Set(previous);
			if (!next.delete(id)) next.add(id);
			return next;
		});

	const activeFolderId =
		search?.view === "folder" ? (search.folderId ?? null) : null;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center justify-between px-2 py-1">
				<SectionLabel>{T.sidebar.foldersTitle}</SectionLabel>
				<Button
					variant="ghost"
					size="icon"
					className="size-6"
					aria-label={T.sidebar.newFolder}
					onClick={() => setDialog({ mode: "create", parentId: null })}
				>
					<IconPlus className="size-3.5" />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{tree.map((node) => (
					<FolderTreeItem
						key={node.id}
						node={node}
						depth={0}
						// While filtering, ancestors of matches must stay visible.
						isExpanded={(id) => filtering || expandedIds.has(id)}
						onToggle={toggle}
						activeFolderId={activeFolderId}
						onCreateChild={(parent) =>
							setDialog({
								mode: "create",
								parentId: parent.id,
								parentName: parent.name,
							})
						}
						onRename={(folder) =>
							setDialog({
								mode: "rename",
								folderId: folder.id,
								currentName: folder.name,
							})
						}
						onDelete={setDeleting}
					/>
				))}
			</div>

			<FolderNameDialog state={dialog} onClose={() => setDialog(null)} />

			<AlertDialog
				open={deleting !== null}
				onOpenChange={(open) => !open && setDeleting(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{deleting ? T.folderMenu.deleteTitle(deleting.name) : ""}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{T.folderMenu.deleteDesc}
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
							{T.folderMenu.deleteAction}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
