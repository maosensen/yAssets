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
	IconWatched,
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
import { RowCount, sidebarRowClass } from "./row";

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
	/** Folders a watched directory imports into — badged so it's obvious their
	 *  contents change on their own. Spread down the recursion with the rest. */
	watchedFolderIds: ReadonlySet<string>;
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
		watchedFolderIds,
	} = props;
	const expanded = isExpanded(node.id);
	const active = activeFolderId === node.id;
	const drop = useDropTarget({ kind: "folder", id: node.id });
	const dropZone = useFolderDropZone(node);

	// A custom icon overrides the default; without one, the default folder glyph
	// fills in (bold) on the active row. Color, if set, tints whichever glyph.
	const CustomIcon = resolveFolderIcon(node.icon);
	const FolderGlyph = CustomIcon ?? (active ? IconFolderBold : IconFolder);
	const watched = watchedFolderIds.has(node.id);

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger
					className={cn(
						"relative flex items-center rounded-md",
						(drop.isOver || dropZone.zone === "into") &&
							"ring-2 ring-primary ring-inset",
					)}
					style={{ paddingLeft: depth * 10 }}
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
					{/* A narrow but full-height slot: the arrow reads as a hint rather
					    than a button-sized control, while staying easy to hit. Leaf
					    rows keep the same width so names line up with their siblings. */}
					{node.children.length > 0 ? (
						<button
							type="button"
							className="flex w-3.5 shrink-0 self-stretch items-center justify-center rounded hover:bg-sidebar-accent"
							aria-label={expanded ? T.sidebar.collapse : T.sidebar.expand}
							onClick={() => onToggle(node.id)}
						>
							<IconChevronRight
								className={cn(
									"size-3 text-muted-foreground transition-transform",
									expanded && "rotate-90",
								)}
							/>
						</button>
					) : (
						<span className="w-3.5 shrink-0" />
					)}
					<Link
						to="/"
						search={{ view: "folder", folderId: node.id }}
						className={sidebarRowClass(
							active,
							// The chevron slot already supplies the left inset.
							"min-w-0 flex-1 gap-1.5 pl-1",
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
						<span
							className="relative flex shrink-0"
							title={watched ? T.watched.autoImport : undefined}
						>
							<FolderGlyph
								className="size-4"
								style={node.color ? { color: node.color } : undefined}
							/>
							{watched && (
								// Corner badge, not a trailing marker: the row's trailing
								// slot is the count column, and shifting counts on some
								// rows would break the alignment `RowCount` exists for.
								<IconWatched
									aria-hidden
									className="-right-0.5 -bottom-0.5 absolute size-3 rounded-full bg-sidebar text-primary"
								/>
							)}
						</span>
						<span className="min-w-0 flex-1 truncate">{node.name}</span>
						<RowCount value={node.assetCount} />
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
