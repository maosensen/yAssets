/**
 * Inspector body for a multi-selection: count + batch actions (rating, tags,
 * add-to-folder, export, trash / restore). Rendered keyed by the selection in
 * inspector-panel, so the local pending rating resets when the selection
 * changes.
 */

import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { FolderPicker } from "@/components/folder-picker";
import {
	IconExport,
	IconFolderAdd,
	IconMulti,
	IconRestore,
	IconTrash,
} from "@/components/icons";
import { RatingStars } from "@/components/inspector/rating-stars";
import { DashedDivider, SectionLabel } from "@/components/inspector/section";
import { TagChips } from "@/components/inspector/tag-chips";
import { Button } from "@/components/ui/button";
import { useExport } from "@/hooks/use-export";
import {
	useRestoreAssets,
	useSetAssetsRating,
	useTrashAssets,
} from "@/lib/queries/assets";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { T } from "@/lib/text";

export function MultiSummary({ ids }: { ids: string[] }) {
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const inTrash = search?.view === "trash";
	const clearSelection = useSelectionStore((state) => state.clear);

	const trashMutation = useTrashAssets();
	const restoreMutation = useRestoreAssets();
	const setRatingMutation = useSetAssetsRating();
	const { exportAssets } = useExport();

	const [rating, setRating] = useState(0);
	const [pickerOpen, setPickerOpen] = useState(false);

	return (
		<div className="flex h-full flex-col overflow-y-auto p-4">
			<div className="flex flex-col items-center gap-1.5 pt-6 pb-2">
				<div className="flex size-12 items-center justify-center rounded-md border border-border/70 border-dashed bg-muted/40">
					<IconMulti className="size-5 text-muted-foreground/70" />
				</div>
				<p className="font-medium text-sm">{T.multi.title(ids.length)}</p>
			</div>

			{!inTrash && (
				<>
					<DashedDivider />
					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<SectionLabel>{T.inspector.ratingLabel}</SectionLabel>
							<RatingStars
								value={rating}
								onChange={(next) => {
									setRating(next);
									setRatingMutation.mutate({ assetIds: ids, rating: next });
								}}
							/>
						</div>

						<TagChips assetIds={ids} />

						<div className="flex flex-col gap-2">
							<SectionLabel>{T.inspector.foldersLabel}</SectionLabel>
							<Button
								variant="outline"
								size="sm"
								className="justify-start"
								onClick={() => setPickerOpen(true)}
							>
								<IconFolderAdd className="size-4" />
								{T.assetMenu.addToFolder}
							</Button>
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

			<FolderPicker
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				assetIds={ids}
			/>
		</div>
	);
}
