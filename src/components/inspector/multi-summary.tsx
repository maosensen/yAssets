/**
 * Inspector body for a multi-selection: count + batch actions
 * (tag, add-to-folder, trash / restore in trash view).
 */

import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import {
	CopyCheck,
	FolderPlus,
	RotateCcw,
	SquareArrowOutUpRight,
	Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { TagChips } from "@/components/inspector/tag-chips";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExport } from "@/hooks/use-export";
import { buildFolderTree, flattenFolderTree } from "@/lib/folder-tree";
import { useRestoreAssets, useTrashAssets } from "@/lib/queries/assets";
import {
	foldersQueryOptions,
	useAddAssetsToFolder,
} from "@/lib/queries/folders";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { T } from "@/lib/text";

export function MultiSummary({ ids }: { ids: string[] }) {
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const inTrash = search?.view === "trash";
	const clearSelection = useSelectionStore((state) => state.clear);

	const { data: folders } = useQuery(foldersQueryOptions());
	const flat = useMemo(
		() => flattenFolderTree(buildFolderTree(folders ?? [])),
		[folders],
	);
	const addToFolder = useAddAssetsToFolder();
	const trashMutation = useTrashAssets();
	const restoreMutation = useRestoreAssets();
	const { exportAssets } = useExport();

	return (
		<div className="flex h-full flex-col gap-5 overflow-y-auto p-3">
			<div className="flex flex-col items-center gap-1 pt-6">
				<CopyCheck className="size-8 text-muted-foreground/60" />
				<p className="font-medium text-sm">{T.multi.title(ids.length)}</p>
			</div>

			{!inTrash && (
				<>
					<TagChips assetIds={ids} />

					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">
							{T.inspector.foldersLabel}
						</span>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="outline"
										size="sm"
										className="justify-start"
									/>
								}
							>
								<FolderPlus className="size-4" />
								{T.assetMenu.addToFolder}
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								{flat.length === 0 ? (
									<DropdownMenuItem disabled>
										{T.assetMenu.noFolders}
									</DropdownMenuItem>
								) : (
									flat.map(({ node, depth }) => (
										<DropdownMenuItem
											key={node.id}
											style={{ paddingLeft: 8 + depth * 12 }}
											onClick={() =>
												addToFolder.mutate({
													assetIds: ids,
													folderId: node.id,
												})
											}
										>
											{node.name}
										</DropdownMenuItem>
									))
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</>
			)}

			<div className="mt-auto flex flex-col gap-2">
				{!inTrash && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => void exportAssets(ids)}
					>
						<SquareArrowOutUpRight className="size-4" />
						{T.export.actionN(ids.length)}
					</Button>
				)}
				{inTrash ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							restoreMutation.mutate(ids);
							clearSelection();
						}}
					>
						<RotateCcw className="size-4" />
						{T.multi.restore(ids.length)}
					</Button>
				) : (
					<Button
						variant="outline"
						size="sm"
						className="text-destructive"
						onClick={() => {
							trashMutation.mutate(ids);
							clearSelection();
						}}
					>
						<Trash2 className="size-4" />
						{T.multi.trash(ids.length)}
					</Button>
				)}
			</div>
		</div>
	);
}
