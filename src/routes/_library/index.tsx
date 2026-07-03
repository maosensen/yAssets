/**
 * "/" — the main library view. The view state (smart view / folder / search
 * term) lives in search params (zod-validated), so back/forward buttons ride
 * the router history for free and the sidebar derives active state from one
 * source of truth.
 */

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetGrid } from "@/components/grid/asset-grid";
import { GridEmptyState } from "@/components/grid/grid-empty-state";
import { Toolbar } from "@/components/layout/toolbar";
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
import { pickDirectory, pickFiles } from "@/lib/dialogs";
import { libraryViewSchema, scopeFromView } from "@/lib/library-view";
import {
	assetListQueryOptions,
	useDeleteAssetsForever,
	useEmptyTrash,
	useTrashAssets,
} from "@/lib/queries/assets";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";

export const Route = createFileRoute("/_library/")({
	validateSearch: libraryViewSchema,
	component: LibraryHome,
});

function LibraryHome() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const sort = useViewPrefsStore((state) => state.sort);
	const dir = useViewPrefsStore((state) => state.dir);
	// scopeFromView only reads view/folderId, but depend on the whole
	// (immutable) search object to keep exhaustive-deps honest.
	const scope = useMemo(() => scopeFromView(search), [search]);
	const { data } = useQuery(
		assetListQueryOptions({ scope, search: search.q, sort, dir }),
	);
	// Latest list for the stable-deps keyboard handler (Cmd+A).
	const dataRef = useRef(data);
	dataRef.current = data;

	const { importPaths, isImporting } = useImport();
	const trashMutation = useTrashAssets();
	const deleteForeverMutation = useDeleteAssetsForever();
	const emptyTrashMutation = useEmptyTrash();
	const clearSelection = useSelectionStore((state) => state.clear);
	const [deleteForeverIds, setDeleteForeverIds] = useState<string[] | null>(
		null,
	);
	const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);

	const inTrash = search.view === "trash";
	const currentFolderId =
		search.view === "folder" ? (search.folderId ?? null) : null;

	// Double-click → full-pane preview route, carrying the view context so
	// prev/next walk the same list.
	const openPreview = useCallback(
		(id: string) => {
			void navigate({ to: "/preview", search: { ...search, id } });
		},
		[navigate, search],
	);

	// View switch: reset selection (ids may not exist in the new slice).
	useEffect(() => {
		clearSelection();
	}, [clearSelection]);

	// Keyboard: Delete/Backspace trashes the selection (outside trash view);
	// Esc clears it. Skipped while typing in inputs.
	useEffect(() => {
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
			// Cmd/Ctrl+A — select everything in the current view.
			if ((event.metaKey || event.ctrlKey) && event.key === "a") {
				event.preventDefault();
				const current = dataRef.current;
				if (current && current.items.length > 0) {
					useSelectionStore
						.getState()
						.selectMany(current.items.map((asset) => asset.id));
				}
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
	}, [inTrash, trashMutation, clearSelection]);

	const importFiles = async () => {
		const files = await pickFiles(T.import.importFiles);
		importPaths(files, currentFolderId);
	};
	const importFolder = async () => {
		const dir = await pickDirectory(T.import.importFolder);
		if (dir) importPaths([dir], currentFolderId);
	};

	const emptyHint = (() => {
		if (!data || data.items.length > 0) return null;
		if (search.q) return T.gridEmpty.noSearchResult;
		switch (search.view) {
			case "trash":
				return T.trashUi.emptyState;
			case "folder":
				return T.gridEmpty.folderEmpty;
			case "tag":
				return T.gridEmpty.tagEmpty;
			case "color":
				return T.gridEmpty.colorEmpty;
			case "uncategorized":
				return T.gridEmpty.uncategorizedEmpty;
			case "untagged":
				return T.gridEmpty.untaggedEmpty;
			case "recent":
				return T.gridEmpty.recentEmpty;
			default:
				return null; // "all" empty → full import empty state
		}
	})();

	return (
		// Center column anatomy: header (Toolbar) + optional trash bar + main.
		<div className="flex h-full flex-col">
			<Toolbar />
			{data && inTrash && data.total != null && data.total > 0 && (
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
				{!data ? null : data.items.length === 0 ? (
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
						onRequestDeleteForever={setDeleteForeverIds}
					/>
				)}
			</div>

			<AlertDialog
				open={deleteForeverIds !== null}
				onOpenChange={(open) => !open && setDeleteForeverIds(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{T.trashUi.confirmDeleteTitle}</AlertDialogTitle>
						<AlertDialogDescription>
							{T.trashUi.confirmDeleteDesc(deleteForeverIds?.length ?? 1)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{T.common.cancel}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deleteForeverIds && deleteForeverIds.length > 0) {
									deleteForeverMutation.mutate(deleteForeverIds);
									clearSelection();
								}
								setDeleteForeverIds(null);
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
