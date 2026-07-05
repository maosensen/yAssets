/**
 * Subfolder strip — sits above the grid in a folder view and lists the
 * folder's DIRECT child folders as navigable tiles (name + alive-asset count).
 * Reuses the sidebar's drop-target so cards can be dragged into a subfolder.
 * Renders nothing when the folder has no children (zero layout cost).
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { IconFolder } from "@/components/icons";
import { useDropTarget } from "@/hooks/use-drop-target";
import type { Folder } from "@/lib/bindings";
import { foldersQueryOptions } from "@/lib/queries/folders";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

export function SubfolderStrip({ folderId }: { folderId: string }) {
	const { data: folders } = useQuery(foldersQueryOptions());
	const children = (folders ?? []).filter((f) => f.parent_id === folderId);
	if (children.length === 0) return null;

	return (
		<div className="shrink-0 border-b px-4 py-3">
			<div className="mb-2 font-medium text-muted-foreground text-xs">
				{T.folderStrip.subfolders(children.length)}
			</div>
			<div className="flex flex-wrap gap-2">
				{children.map((folder) => (
					<SubfolderTile key={folder.id} folder={folder} />
				))}
			</div>
		</div>
	);
}

function SubfolderTile({ folder }: { folder: Folder }) {
	const drop = useDropTarget({ kind: "folder", id: folder.id });
	return (
		<Link
			to="/"
			search={{ view: "folder", folderId: folder.id }}
			className={cn(
				"flex min-w-40 max-w-56 items-center gap-2 rounded-md border bg-card/40 px-2.5 py-1.5 text-sm hover:bg-accent",
				drop.isOver && "ring-2 ring-primary ring-inset",
			)}
			onPointerEnter={drop.onPointerEnter}
			onPointerLeave={drop.onPointerLeave}
			onPointerUp={drop.onPointerUp}
		>
			<IconFolder className="size-4 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate">{folder.name}</span>
			{folder.asset_count > 0 && (
				<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
					{folder.asset_count}
				</span>
			)}
		</Link>
	);
}
