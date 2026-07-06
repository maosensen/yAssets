/**
 * "/" — the main library view. The view state (smart view / folder / search
 * term) lives in search params (zod-validated), so back/forward buttons ride
 * the router history for free and the sidebar derives active state from one
 * source of truth.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { AssetGrid } from "@/components/grid/asset-grid";
import { GridEmptyState } from "@/components/grid/grid-empty-state";
import { SubfolderStrip } from "@/components/grid/subfolder-strip";
import {
	type IconComponent,
	IconFolderOpen,
	IconMagic,
	IconMulti,
	IconPalette,
	IconRecent,
	IconSearch,
	IconTag,
	IconTrash,
	IconUncategorized,
} from "@/components/icons";
import { Toolbar } from "@/components/layout/toolbar";
import { QuickLook } from "@/components/preview/quick-look";
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
import { useImport, useImportClipboard } from "@/hooks/use-import";
import { pickDirectory, pickFiles } from "@/lib/dialogs";
import { libraryViewSchema } from "@/lib/library-view";
import {
	fetchAssetIdsForView,
	useDeleteAssetsForever,
	useEmptyTrash,
	useLibraryAssetList,
	useTrashAssets,
} from "@/lib/queries/assets";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";
import { viewerKindFor } from "@/lib/viewer-registry";

export const Route = createFileRoute("/_library/")({
	validateSearch: libraryViewSchema,
	component: LibraryHome,
});

function LibraryHome() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const sort = useViewPrefsStore((state) => state.sort);
	const dir = useViewPrefsStore((state) => state.dir);
	// One shared hook resolves the view's list (regular scopes AND the
	// ranked similar view) — preview walks the exact same cache entry.
	const list = useLibraryAssetList(search, sort, dir);
	// Latest list for the stable-deps keyboard handler (Cmd+A).
	const listRef = useRef(list);
	listRef.current = list;
	// Fresh view/sort/dir for that same handler (select-all fetches all ids).
	const viewParamsRef = useRef({ view: search, sort, dir });
	viewParamsRef.current = { view: search, sort, dir };

	const { importPaths, isImporting } = useImport();
	const { importClipboard } = useImportClipboard();
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

	// Quick Look (Space): image assets get the overlay, following the grid
	// selection live; other kinds route straight to the full preview.
	const [quickLook, setQuickLook] = useState(false);
	const quickLookRef = useRef(quickLook);
	quickLookRef.current = quickLook;
	const anchorId = useSelectionStore((state) => state.anchorId);
	const quickAsset = quickLook
		? list.items.find((asset) => asset.id === anchorId)
		: undefined;
	useEffect(() => {
		// Selection moved off-image / got cleared → drop the overlay.
		if (quickLook && (!quickAsset || viewerKindFor(quickAsset) !== "image")) {
			setQuickLook(false);
		}
	}, [quickLook, quickAsset]);

	// Double-click → full-pane preview route, carrying the view context so
	// prev/next walk the same list.
	const openPreview = useCallback(
		(id: string) => {
			void navigate({ to: "/preview", search: { ...search, id } });
		},
		[navigate, search],
	);
	// Latest for the stable-deps keyboard handler (Space on non-images).
	const openPreviewRef = useRef(openPreview);
	openPreviewRef.current = openPreview;

	// View switch: reset selection (ids may not exist in the new slice).
	useEffect(() => {
		clearSelection();
	}, [clearSelection]);

	// Keyboard: Delete/Backspace trashes the selection (outside trash view);
	// Esc clears it (or closes Quick Look); Space toggles Quick Look;
	// Enter/F2 focuses rename; ⌘V imports from the clipboard. Skipped while
	// typing or inside dialogs.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable ||
					target.closest('[role="dialog"]'))
			) {
				return;
			}
			if (event.key === "Escape") {
				if (quickLookRef.current) setQuickLook(false);
				else clearSelection();
				return;
			}
			// Space — Quick Look for images, full preview for everything else.
			if (event.key === " ") {
				event.preventDefault();
				if (quickLookRef.current) {
					setQuickLook(false);
					return;
				}
				const { anchorId: anchor } = useSelectionStore.getState();
				const asset = listRef.current.items.find((a) => a.id === anchor);
				if (!asset) return;
				if (viewerKindFor(asset) === "image") setQuickLook(true);
				else openPreviewRef.current(asset.id);
				return;
			}
			// Enter / F2 — rename the single selected asset (Finder semantics).
			if (event.key === "Enter" || event.key === "F2") {
				const { selectedIds } = useSelectionStore.getState();
				if (selectedIds.size !== 1) return;
				event.preventDefault();
				useUiStore.getState().requestRename();
				return;
			}
			// Cmd/Ctrl+A — select EVERY matching asset, including rows the grid
			// hasn't paged in yet (via the unpaged list_asset_ids command).
			if ((event.metaKey || event.ctrlKey) && event.key === "a") {
				event.preventDefault();
				const { view, sort: s, dir: d } = viewParamsRef.current;
				// Similar view is a single capped query — select what's loaded.
				if (view.view === "similar") {
					const items = listRef.current.items;
					if (items.length > 0) {
						useSelectionStore.getState().selectMany(items.map((a) => a.id));
					}
					return;
				}
				void fetchAssetIdsForView(view, s, d)
					.then((ids) => {
						if (ids.length > 0) useSelectionStore.getState().selectMany(ids);
					})
					.catch(() => {});
				return;
			}
			// Cmd/Ctrl+V — paste external assets (files or a bitmap) into the
			// current folder view.
			if ((event.metaKey || event.ctrlKey) && event.key === "v") {
				event.preventDefault();
				importClipboard(currentFolderId);
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
	}, [
		inTrash,
		trashMutation,
		clearSelection,
		importClipboard,
		currentFolderId,
	]);

	const importFiles = async () => {
		const files = await pickFiles(T.import.importFiles);
		importPaths(files, currentFolderId);
	};
	const importFolder = async () => {
		const dir = await pickDirectory(T.import.importFolder);
		if (dir) importPaths([dir], currentFolderId);
	};

	// Per-view empty placeholder (unified EmptyState); null on an empty "all"
	// view, which gets the full import empty state instead.
	const emptyState = ((): {
		icon: IconComponent;
		copy: { title: string; hint: string };
	} | null => {
		if (list.isLoading || list.items.length > 0) return null;
		if (search.q) return { icon: IconSearch, copy: T.gridEmpty.noSearchResult };
		switch (search.view) {
			case "trash":
				return { icon: IconTrash, copy: T.gridEmpty.trashEmpty };
			case "folder":
				return { icon: IconFolderOpen, copy: T.gridEmpty.folderEmpty };
			case "tag":
				return { icon: IconTag, copy: T.gridEmpty.tagEmpty };
			case "color":
				return { icon: IconPalette, copy: T.gridEmpty.colorEmpty };
			case "uncategorized":
				return {
					icon: IconUncategorized,
					copy: T.gridEmpty.uncategorizedEmpty,
				};
			case "untagged":
				return { icon: IconTag, copy: T.gridEmpty.untaggedEmpty };
			case "recent":
				return { icon: IconRecent, copy: T.gridEmpty.recentEmpty };
			case "similar":
				return { icon: IconMulti, copy: T.gridEmpty.similarEmpty };
			case "smart":
				return { icon: IconMagic, copy: T.gridEmpty.smartEmpty };
			default:
				return null;
		}
	})();

	return (
		// Center column anatomy: header (Toolbar) + optional trash bar + main.
		<div className="flex h-full flex-col">
			<Toolbar />
			{inTrash && list.total > 0 && (
				<div className="flex items-center justify-between border-b px-4 py-2">
					<span className="text-muted-foreground text-sm">
						{T.trashUi.itemsInTrash(list.total)}
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setConfirmEmptyTrash(true)}
						disabled={emptyTrashMutation.isPending}
					>
						<IconTrash className="size-4" />
						{T.trashUi.emptyTrash}
					</Button>
				</div>
			)}

			<div className="flex min-h-0 flex-1 flex-col">
				{currentFolderId && <SubfolderStrip folderId={currentFolderId} />}
				<div className="min-h-0 flex-1">
					{list.isLoading ? null : list.items.length === 0 ? (
						emptyState ? (
							<EmptyState
								icon={emptyState.icon}
								title={emptyState.copy.title}
								hint={emptyState.copy.hint}
							/>
						) : (
							<GridEmptyState
								importing={isImporting}
								onImportFiles={() => void importFiles()}
								onImportFolder={() => void importFolder()}
							/>
						)
					) : (
						<AssetGrid
							assets={list.items}
							onOpen={openPreview}
							inTrash={inTrash}
							currentFolderId={currentFolderId}
							onRequestDeleteForever={setDeleteForeverIds}
							hasNextPage={list.hasNextPage}
							isFetchingNextPage={list.isFetchingNextPage}
							onLoadMore={list.fetchNextPage}
						/>
					)}
				</div>
			</div>

			{quickAsset && (
				<QuickLook asset={quickAsset} onClose={() => setQuickLook(false)} />
			)}

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
