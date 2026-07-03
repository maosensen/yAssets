/**
 * Context-menu items for a grid card. Actions target the WHOLE selection
 * when the clicked card is part of a multi-selection (right-click keeps
 * multi-selections alive — see the grid's handleContextSelect), otherwise
 * just the clicked card. Mounted only while the menu is open.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useExport } from "@/hooks/use-export";
import { buildFolderTree, flattenFolderTree } from "@/lib/folder-tree";
import {
	revealAsset,
	useRestoreAssets,
	useTrashAssets,
} from "@/lib/queries/assets";
import {
	foldersQueryOptions,
	useAddAssetsToFolder,
	useRemoveAssetsFromFolder,
} from "@/lib/queries/folders";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { T } from "@/lib/text";

type AssetContextItemsProps = {
	assetId: string;
	inTrash: boolean;
	/** Set when the grid currently shows a folder view. */
	currentFolderId: string | null;
	onRequestDeleteForever: (ids: string[]) => void;
};

/** The clicked card + the rest of the selection it belongs to. */
function targetIds(assetId: string): string[] {
	const { selectedIds } = useSelectionStore.getState();
	return selectedIds.has(assetId) && selectedIds.size > 1
		? [...selectedIds]
		: [assetId];
}

/** `label` or `label（N 项）` for batch actions. */
function withCount(label: string, count: number): string {
	return count > 1 ? `${label}（${count} 项）` : label;
}

export function AssetContextItems({
	assetId,
	inTrash,
	currentFolderId,
	onRequestDeleteForever,
}: AssetContextItemsProps) {
	const trashMutation = useTrashAssets();
	const restoreMutation = useRestoreAssets();
	const addMutation = useAddAssetsToFolder();
	const removeMutation = useRemoveAssetsFromFolder();
	const { exportAssets } = useExport();
	const { data: folders } = useQuery(foldersQueryOptions());
	const flat = useMemo(
		() => flattenFolderTree(buildFolderTree(folders ?? [])),
		[folders],
	);

	// Selection size at open time — the menu is mounted per open.
	const count = targetIds(assetId).length;

	if (inTrash) {
		return (
			<>
				<ContextMenuItem
					onClick={() => restoreMutation.mutate(targetIds(assetId))}
				>
					{withCount(T.assetMenu.restore, count)}
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					onClick={() => onRequestDeleteForever(targetIds(assetId))}
				>
					<span className="text-destructive">
						{withCount(T.assetMenu.deleteForever, count)}
					</span>
				</ContextMenuItem>
			</>
		);
	}

	return (
		<>
			<ContextMenuSub>
				<ContextMenuSubTrigger>
					{withCount(T.assetMenu.addToFolder, count)}
				</ContextMenuSubTrigger>
				<ContextMenuSubContent>
					{flat.length === 0 ? (
						<ContextMenuItem disabled>{T.assetMenu.noFolders}</ContextMenuItem>
					) : (
						flat.map(({ node, depth }) => (
							<ContextMenuItem
								key={node.id}
								style={{ paddingLeft: 8 + depth * 12 }}
								onClick={() =>
									addMutation.mutate({
										assetIds: targetIds(assetId),
										folderId: node.id,
									})
								}
							>
								{node.name}
							</ContextMenuItem>
						))
					)}
				</ContextMenuSubContent>
			</ContextMenuSub>
			{currentFolderId && (
				<ContextMenuItem
					onClick={() =>
						removeMutation.mutate({
							assetIds: targetIds(assetId),
							folderId: currentFolderId,
						})
					}
				>
					{withCount(T.assetMenu.removeFromFolder, count)}
				</ContextMenuItem>
			)}
			<ContextMenuSeparator />
			<ContextMenuItem onClick={() => void exportAssets(targetIds(assetId))}>
				{withCount(T.assetMenu.export, count)}
			</ContextMenuItem>
			{count === 1 && (
				<ContextMenuItem onClick={() => revealAsset(assetId)}>
					{T.assetMenu.reveal}
				</ContextMenuItem>
			)}
			<ContextMenuSeparator />
			<ContextMenuItem onClick={() => trashMutation.mutate(targetIds(assetId))}>
				<span className="text-destructive">
					{withCount(T.assetMenu.trash, count)}
				</span>
			</ContextMenuItem>
		</>
	);
}
