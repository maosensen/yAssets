/**
 * One folder row: chevron (separate button — no nested interactives),
 * navigation link, alive-asset count, and the folder context menu.
 */

import { Link } from "@tanstack/react-router";
import { ChevronRight, Folder as FolderIcon } from "lucide-react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDropTarget } from "@/hooks/use-drop-target";
import type { FolderNode } from "@/lib/folder-tree";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

type FolderTreeItemProps = {
	node: FolderNode;
	depth: number;
	isExpanded: (id: string) => boolean;
	onToggle: (id: string) => void;
	activeFolderId: string | null;
	onCreateChild: (folder: FolderNode) => void;
	onRename: (folder: FolderNode) => void;
	onDelete: (folder: FolderNode) => void;
};

export function FolderTreeItem(props: FolderTreeItemProps) {
	const {
		node,
		depth,
		isExpanded,
		onToggle,
		activeFolderId,
		onCreateChild,
		onRename,
		onDelete,
	} = props;
	const expanded = isExpanded(node.id);
	const active = activeFolderId === node.id;
	const drop = useDropTarget({ kind: "folder", id: node.id });

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger
					className={cn(
						"flex items-center rounded-md",
						drop.isOver && "ring-2 ring-primary ring-inset",
					)}
					style={{ paddingLeft: depth * 12 }}
					onPointerEnter={drop.onPointerEnter}
					onPointerLeave={drop.onPointerLeave}
					onPointerUp={drop.onPointerUp}
				>
					{node.children.length > 0 ? (
						<button
							type="button"
							className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent"
							aria-label={expanded ? "折叠" : "展开"}
							onClick={() => onToggle(node.id)}
						>
							<ChevronRight
								className={cn(
									"size-3.5 text-muted-foreground transition-transform",
									expanded && "rotate-90",
								)}
							/>
						</button>
					) : (
						<span className="size-5 shrink-0" />
					)}
					<Link
						to="/"
						search={{ view: "folder", folderId: node.id }}
						className={cn(
							"flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm hover:bg-sidebar-accent",
							active
								? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
								: "text-sidebar-foreground/80",
						)}
					>
						<FolderIcon className="size-4 shrink-0" />
						<span className="min-w-0 flex-1 truncate">{node.name}</span>
						{node.assetCount > 0 && (
							<span className="text-muted-foreground text-xs tabular-nums">
								{node.assetCount}
							</span>
						)}
					</Link>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onClick={() => onCreateChild(node)}>
						{T.folderMenu.newSubfolder}
					</ContextMenuItem>
					<ContextMenuItem onClick={() => onRename(node)}>
						{T.folderMenu.rename}
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onClick={() => onDelete(node)}>
						<span className="text-destructive">{T.folderMenu.delete}</span>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{expanded &&
				node.children.map((child) => (
					<FolderTreeItem
						key={child.id}
						{...props}
						node={child}
						depth={depth + 1}
					/>
				))}
		</>
	);
}
