/**
 * Context-menu items for one asset card. Mounted only while the menu is
 * open (Base UI portals the popup), so the hooks here don't burden the
 * virtualized grid.
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
import { T } from "@/lib/text";

type AssetContextItemsProps = {
	assetId: string;
	inTrash: boolean;
	/** Set when the grid currently shows a folder view. */
	currentFolderId: string | null;
	onRequestDeleteForever: (id: string) => void;
};

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
	const { data: folders } = useQuery(foldersQueryOptions());
	const flat = useMemo(
		() => flattenFolderTree(buildFolderTree(folders ?? [])),
		[folders],
	);

	if (inTrash) {
		return (
			<>
				<ContextMenuItem onClick={() => restoreMutation.mutate([assetId])}>
					{T.assetMenu.restore}
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem onClick={() => onRequestDeleteForever(assetId)}>
					<span className="text-destructive">{T.assetMenu.deleteForever}</span>
				</ContextMenuItem>
			</>
		);
	}

	return (
		<>
			<ContextMenuSub>
				<ContextMenuSubTrigger>{T.assetMenu.addToFolder}</ContextMenuSubTrigger>
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
										assetIds: [assetId],
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
							assetIds: [assetId],
							folderId: currentFolderId,
						})
					}
				>
					{T.assetMenu.removeFromFolder}
				</ContextMenuItem>
			)}
			<ContextMenuSeparator />
			<ContextMenuItem onClick={() => revealAsset(assetId)}>
				{T.assetMenu.reveal}
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem onClick={() => trashMutation.mutate([assetId])}>
				<span className="text-destructive">{T.assetMenu.trash}</span>
			</ContextMenuItem>
		</>
	);
}
