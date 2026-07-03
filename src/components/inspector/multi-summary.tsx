/**
 * Inspector body for a multi-selection: count + batch actions
 * (tag, add-to-folder, trash / restore in trash view).
 */

import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	IconExport,
	IconFolderAdd,
	IconMulti,
	IconRestore,
	IconTrash,
} from "@/components/icons";
import { DashedDivider, SectionLabel } from "@/components/inspector/section";
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
		<div className="flex h-full flex-col overflow-y-auto p-4">
			<div className="flex flex-col items-center gap-1.5 pt-6 pb-2">
				<div className="flex size-12 items-center justify-center rounded-xl border border-border/70 border-dashed bg-muted/40">
					<IconMulti className="size-5 text-muted-foreground/70" />
				</div>
				<p className="font-medium text-sm">{T.multi.title(ids.length)}</p>
			</div>

			{!inTrash && (
				<>
					<DashedDivider />
					<div className="flex flex-col gap-4">
						<TagChips assetIds={ids} />

						<div className="flex flex-col gap-2">
							<SectionLabel>{T.inspector.foldersLabel}</SectionLabel>
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
									<IconFolderAdd className="size-4" />
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
					</div>
				</>
			)}

			<div className="mt-auto flex flex-col gap-2 pt-4">
				<DashedDivider className="my-0 mb-1" />
				{!inTrash && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => void exportAssets(ids)}
					>
						<IconExport className="size-4" />
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
						<IconRestore className="size-4" />
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
						<IconTrash className="size-4" />
						{T.multi.trash(ids.length)}
					</Button>
				)}
			</div>
		</div>
	);
}
