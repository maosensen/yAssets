/**
 * Context-menu items for a grid card. Actions target the WHOLE selection
 * when the clicked card is part of a multi-selection (right-click keeps
 * multi-selections alive — see the grid's handleContextSelect), otherwise
 * just the clicked card. Mounted only while the menu is open.
 */

import { useNavigate } from "@tanstack/react-router";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useExport } from "@/hooks/use-export";
import {
	revealAsset,
	useRegenerateCover,
	useRestoreAssets,
	useTrashAssets,
} from "@/lib/queries/assets";
import { useRemoveAssetsFromFolder } from "@/lib/queries/folders";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { T } from "@/lib/text";
import { VIDEO_EXTS } from "@/lib/viewer-registry";

type AssetContextItemsProps = {
	assetId: string;
	/** The clicked card's extension — gates video-only actions. */
	ext: string;
	inTrash: boolean;
	/** Set when the grid currently shows a folder view. */
	currentFolderId: string | null;
	/** Opens the folder picker for the given assets (state lives in the grid). */
	onAddToFolder: (ids: string[]) => void;
	onRequestDeleteForever: (ids: string[]) => void;
};

/** The clicked card + the rest of the selection it belongs to. */
function targetIds(assetId: string): string[] {
	const { selectedIds } = useSelectionStore.getState();
	return selectedIds.has(assetId) && selectedIds.size > 1
		? [...selectedIds]
		: [assetId];
}

/** `label` or `label (N)` for batch actions. */
function withCount(label: string, count: number): string {
	return count > 1 ? `${label} (${count})` : label;
}

export function AssetContextItems({
	assetId,
	ext,
	inTrash,
	currentFolderId,
	onAddToFolder,
	onRequestDeleteForever,
}: AssetContextItemsProps) {
	const navigate = useNavigate();
	const trashMutation = useTrashAssets();
	const restoreMutation = useRestoreAssets();
	const removeMutation = useRemoveAssetsFromFolder();
	const regenerateCover = useRegenerateCover();
	const { exportAssets } = useExport();

	// Selection size at open time — the menu is mounted per open.
	const count = targetIds(assetId).length;
	const isVideo = VIDEO_EXTS.has(ext.toLowerCase());

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
			<ContextMenuItem onClick={() => onAddToFolder(targetIds(assetId))}>
				{withCount(T.assetMenu.addToFolder, count)}
			</ContextMenuItem>
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
				<>
					<ContextMenuItem
						onClick={() =>
							void navigate({
								to: "/",
								search: { view: "similar", similarTo: assetId },
							})
						}
					>
						{T.assetMenu.findSimilar}
					</ContextMenuItem>
					<ContextMenuItem onClick={() => revealAsset(assetId)}>
						{T.assetMenu.reveal}
					</ContextMenuItem>
					{isVideo && (
						<ContextMenuItem onClick={() => regenerateCover.mutate(assetId)}>
							{T.assetMenu.regenerateCover}
						</ContextMenuItem>
					)}
				</>
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
