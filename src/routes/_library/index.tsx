/**
 * "/" — the main library view. The view state (smart view / folder / search
 * term) lives in search params (zod-validated), so back/forward buttons ride
 * the router history for free and the sidebar derives active state from one
 * source of truth.
 */

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { AssetGrid } from "@/components/grid/asset-grid";
import { GridEmptyState } from "@/components/grid/grid-empty-state";
import { PreviewOverlay } from "@/components/preview/preview-overlay";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useImport } from "@/hooks/use-import";
import type { AssetScope } from "@/lib/bindings";
import { pickDirectory, pickFiles } from "@/lib/dialogs";
import {
	assetListQueryOptions,
	useDeleteAssetsForever,
	useEmptyTrash,
	useTrashAssets,
} from "@/lib/queries/assets";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";

const librarySearchSchema = z.object({
	view: z
		.enum(["all", "uncategorized", "recent", "trash", "folder"])
		.catch("all"),
	folderId: z.string().optional(),
	q: z.string().optional(),
});

export type LibrarySearch = z.infer<typeof librarySearchSchema>;

/** "Recent" window, in days. */
const RECENT_DAYS = 30;

export const Route = createFileRoute("/_library/")({
	validateSearch: librarySearchSchema,
	component: LibraryHome,
});

function scopeFromSearch(search: LibrarySearch): AssetScope {
	switch (search.view) {
		case "folder":
			return search.folderId
				? { kind: "folder", folder_id: search.folderId }
				: { kind: "all" };
		case "uncategorized":
			return { kind: "uncategorized" };
		case "recent":
			return { kind: "recent", days: RECENT_DAYS };
		case "trash":
			return { kind: "trash" };
		default:
			return { kind: "all" };
	}
}

function LibraryHome() {
	const search = Route.useSearch();
	const sort = useViewPrefsStore((state) => state.sort);
	const dir = useViewPrefsStore((state) => state.dir);
	// scopeFromSearch only reads view/folderId, but depend on the whole
	// (immutable) search object to keep exhaustive-deps honest.
	const scope = useMemo(() => scopeFromSearch(search), [search]);
	const { data } = useQuery(
		assetListQueryOptions({ scope, search: search.q, sort, dir }),
	);

	const { importPaths, isImporting } = useImport();
	const trashMutation = useTrashAssets();
	const deleteForeverMutation = useDeleteAssetsForever();
	const emptyTrashMutation = useEmptyTrash();
	const clearSelection = useSelectionStore((state) => state.clear);
	const [deleteForeverId, setDeleteForeverId] = useState<string | null>(null);
	const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);

	const inTrash = search.view === "trash";
	const currentFolderId =
		search.view === "folder" ? (search.folderId ?? null) : null;

	const openPreview = useCallback(
		(id: string) => {
			const idx = data?.items.findIndex((asset) => asset.id === id) ?? -1;
			if (idx >= 0) setPreviewIndex(idx);
		},
		[data],
	);

	// View/data changes can shrink the list — keep the index in range.
	useEffect(() => {
		if (previewIndex === null || !data) return;
		if (data.items.length === 0) setPreviewIndex(null);
		else if (previewIndex >= data.items.length) {
			setPreviewIndex(data.items.length - 1);
		}
	}, [previewIndex, data]);

	// View switch: reset selection (ids may not exist in the new slice).
	useEffect(() => {
		clearSelection();
	}, [clearSelection]);

	// Keyboard: Delete/Backspace trashes the selection (outside trash view);
	// Esc clears it. Skipped while typing or while the preview is open
	// (the overlay owns the keyboard then).
	const previewOpen = previewIndex !== null;
	useEffect(() => {
		if (previewOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}
			if (event.key === "Escape") {
				clearSelection();
				return;
			}
			if (event.key === "Delete" || event.key === "Backspace") {
				const { selectedIds } = useSelectionStore.getState();
				if (selectedIds.size === 0 || inTrash) return;
				event.preventDefault();
				trashMutation.mutate([...selectedIds]);
				clearSelection();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [inTrash, trashMutation, clearSelection, previewOpen]);

	const importFiles = async () => {
		const files = await pickFiles(T.import.importFiles);
		importPaths(files, currentFolderId);
	};
	const importFolder = async () => {
		const dir = await pickDirectory(T.import.importFolder);
		if (dir) importPaths([dir], currentFolderId);
	};

	if (!data) return null;

	const emptyHint = (() => {
		if (data.items.length > 0) return null;
		if (search.q) return T.gridEmpty.noSearchResult;
		switch (search.view) {
			case "trash":
				return T.trashUi.emptyState;
			case "folder":
				return T.gridEmpty.folderEmpty;
			case "uncategorized":
				return T.gridEmpty.uncategorizedEmpty;
			case "recent":
				return T.gridEmpty.recentEmpty;
			default:
				return null; // "all" empty → full import empty state
		}
	})();

	return (
		<div className="flex h-full flex-col">
			{inTrash && data.total != null && data.total > 0 && (
				<div className="flex items-center justify-between border-b px-4 py-2">
					<span className="text-muted-foreground text-sm">
						{T.trashUi.itemsInTrash(data.total)}
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setConfirmEmptyTrash(true)}
						disabled={emptyTrashMutation.isPending}
					>
						<Trash2 className="size-4" />
						{T.trashUi.emptyTrash}
					</Button>
				</div>
			)}

			<div className="min-h-0 flex-1">
				{data.items.length === 0 ? (
					emptyHint ? (
						<div className="flex h-full items-center justify-center">
							<p className="text-muted-foreground text-sm">{emptyHint}</p>
						</div>
					) : (
						<GridEmptyState
							importing={isImporting}
							onImportFiles={() => void importFiles()}
							onImportFolder={() => void importFolder()}
						/>
					)
				) : (
					<AssetGrid
						assets={data.items}
						onOpen={openPreview}
						inTrash={inTrash}
						currentFolderId={currentFolderId}
						onRequestDeleteForever={setDeleteForeverId}
					/>
				)}
			</div>

			{previewIndex !== null && data.items.length > 0 && (
				<PreviewOverlay
					assets={data.items}
					index={Math.min(previewIndex, data.items.length - 1)}
					onNavigate={setPreviewIndex}
					onClose={() => setPreviewIndex(null)}
				/>
			)}

			<AlertDialog
				open={deleteForeverId !== null}
				onOpenChange={(open) => !open && setDeleteForeverId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{T.trashUi.confirmDeleteTitle}</AlertDialogTitle>
						<AlertDialogDescription>
							{T.trashUi.confirmDeleteDesc}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{T.common.cancel}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deleteForeverId) {
									deleteForeverMutation.mutate([deleteForeverId]);
								}
								setDeleteForeverId(null);
							}}
						>
							{T.trashUi.confirmAction}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={confirmEmptyTrash} onOpenChange={setConfirmEmptyTrash}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{T.trashUi.confirmEmptyTitle}</AlertDialogTitle>
						<AlertDialogDescription>
							{T.trashUi.confirmEmptyDesc}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{T.common.cancel}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								emptyTrashMutation.mutate();
								setConfirmEmptyTrash(false);
							}}
						>
							{T.trashUi.confirmAction}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
