/**
 * One folder row: chevron (separate button — no nested interactives),
 * navigation link, alive-asset count, and the folder context menu.
 */

import { Link } from "@tanstack/react-router";
import { resolveFolderIcon } from "@/components/folder-icon-catalog";
import {
	IconChevronRight,
	IconFolder,
	IconFolderBold,
} from "@/components/icons";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDropTarget } from "@/hooks/use-drop-target";
import { useFolderDropZone } from "@/hooks/use-folder-drag";
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
	onCustomize: (folder: FolderNode) => void;
	onDelete: (folder: FolderNode) => void;
	/** Spread on the row to make the folder draggable (reorder / reparent). */
	onFolderPointerDown: (
		node: FolderNode,
	) => (event: React.PointerEvent) => void;
	/** True right after a drag, so the trailing click doesn't navigate. */
	draggedRef: React.RefObject<boolean>;
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
		onCustomize,
		onDelete,
		onFolderPointerDown,
		draggedRef,
	} = props;
	const expanded = isExpanded(node.id);
	const active = activeFolderId === node.id;
	const drop = useDropTarget({ kind: "folder", id: node.id });
	const dropZone = useFolderDropZone(node);

	// A custom icon overrides the default; without one, the default folder glyph
	// fills in (bold) on the active row. Color, if set, tints whichever glyph.
	const CustomIcon = resolveFolderIcon(node.icon);
	const FolderGlyph = CustomIcon ?? (active ? IconFolderBold : IconFolder);

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger
					className={cn(
						"relative flex items-center rounded-md",
						(drop.isOver || dropZone.zone === "into") &&
							"ring-2 ring-primary ring-inset",
					)}
					style={{ paddingLeft: depth * 12 }}
					onPointerEnter={drop.onPointerEnter}
					onPointerMove={dropZone.onPointerMove}
					onPointerLeave={() => {
						drop.onPointerLeave();
						dropZone.onPointerLeave();
					}}
					onPointerUp={drop.onPointerUp}
				>
					{dropZone.zone === "before" && (
						<div className="pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 rounded-full bg-primary" />
					)}
					{dropZone.zone === "after" && (
						<div className="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 rounded-full bg-primary" />
					)}
					{node.children.length > 0 ? (
						<button
							type="button"
							className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent"
							aria-label={expanded ? T.sidebar.collapse : T.sidebar.expand}
							onClick={() => onToggle(node.id)}
						>
							<IconChevronRight
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
						// An anchor is natively draggable; without this, a real drag
						// starts an OS drag session that pops the "import" overlay.
						draggable={false}
						onPointerDown={onFolderPointerDown(node)}
						onClick={(event) => {
							// Suppress the navigation click that trails a drag gesture.
							if (draggedRef.current) {
								event.preventDefault();
								event.stopPropagation();
							}
						}}
					>
						<FolderGlyph
							className="size-4 shrink-0"
							style={node.color ? { color: node.color } : undefined}
						/>
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
					<ContextMenuItem onClick={() => onCustomize(node)}>
						{T.folderMenu.customize}
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
