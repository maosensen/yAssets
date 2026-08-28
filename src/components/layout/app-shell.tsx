/**
 * The three-column shell: sidebar | center display area | inspector.
 *
 * Eagle-style region anatomy — each column owns its header/main/footer
 * instead of one full-width toolbar:
 * - Sidebar:  header = library switcher · main = views + folder tree ·
 *             footer = tree filter
 * - Center:   pure <Outlet/> — each route brings its own header (the grid
 *             route mounts the Toolbar, the preview route its own topbar)
 * - Inspector: managed by InspectorPanel (main info + fixed action footer)
 *
 * Rendered by the `_library` layout route, so a library is guaranteed open.
 * Native drag-drop imports into the folder currently in view.
 */

import { Outlet, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { DragGhost } from "@/components/grid/drag-ghost";
import { IconFilter } from "@/components/icons";
import { DropOverlay } from "@/components/import/drop-overlay";
import { DuplicateAlertDialog } from "@/components/import/duplicate-alert-dialog";
import { InspectorPanel } from "@/components/inspector/inspector-panel";
import { DiscoverNav } from "@/components/sidebar/discover-nav";
import { FolderTree } from "@/components/sidebar/folder-tree";
import { LibrarySwitcher } from "@/components/sidebar/library-switcher";
import { SmartFolderList } from "@/components/sidebar/smart-folder-list";
import { SmartViews } from "@/components/sidebar/smart-views";
import { TagList } from "@/components/sidebar/tag-list";
import { Input } from "@/components/ui/input";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	useDefaultLayout,
} from "@/components/ui/resizable";
import { useAgentEvents } from "@/hooks/use-agent-events";
import { useCollectEvents } from "@/hooks/use-collect-events";
import { useCoverWorker } from "@/hooks/use-cover-worker";
import { useDragImport } from "@/hooks/use-drag-import";
import { useImport, useImportEvents } from "@/hooks/use-import";
import { useWindowDrag } from "@/hooks/use-window-drag";
import { T } from "@/lib/text";

export function AppShell() {
	useImportEvents();
	useCollectEvents();
	useAgentEvents();
	useCoverWorker();
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const { importPaths } = useImport();
	const dropFolderId =
		search?.view === "folder" ? (search.folderId ?? null) : null;
	const { isDragOver } = useDragImport((paths) =>
		importPaths(paths, dropFolderId),
	);
	// Rail widths survive a relaunch (localStorage, keyed once for the whole
	// app — this is window chrome, not per-library data).
	//
	// `onlySaveAfterUserInteractions` matters: a window resize also emits a
	// layout change, so without it a maximize/restore cycle would write its own
	// widths back to storage and make them the new normal. Only a deliberate
	// drag of a separator counts.
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: "app-shell",
		onlySaveAfterUserInteractions: true,
	});

	return (
		<div className="flex h-screen flex-col">
			<DropOverlay visible={isDragOver} />
			<DragGhost />
			<DuplicateAlertDialog />
			{/* The two rails keep their pixel width when the window resizes; the
			    content column absorbs the difference. Without
			    `preserve-pixel-size` (the library's default is
			    `preserve-relative-size`) a panel holds its *percentage* of the
			    group, so maximizing scaled both rails up until they hit
			    maxSize — 260px of a 1200px window is 21.7%, which is 416px at
			    1920px wide. Both rails snapped to their maximum on every
			    maximize. The group needs at least one relative panel, which is
			    exactly the role the content column should play anyway. */}
			<ResizablePanelGroup
				className="min-h-0 flex-1"
				defaultLayout={defaultLayout}
				onLayoutChanged={onLayoutChanged}
			>
				<ResizablePanel
					id="sidebar"
					defaultSize="260px"
					minSize="200px"
					maxSize="420px"
					groupResizeBehavior="preserve-pixel-size"
				>
					<Sidebar />
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="content" minSize="320px">
					{/* Content column stays solid — thumbnails need stable ground. */}
					<main className="h-full min-w-0 overflow-hidden bg-background">
						<Outlet />
					</main>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel
					id="inspector"
					defaultSize="280px"
					minSize="240px"
					maxSize="420px"
					groupResizeBehavior="preserve-pixel-size"
				>
					<InspectorPanel />
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}

/** Sidebar column: header (switcher) / main (nav) / footer (filter). */
function Sidebar() {
	const [filter, setFilter] = useState("");
	// The whole sidebar is a window drag surface (press-and-move on empty
	// space, long-press anywhere); double-click on the header zooms.
	const windowDrag = useWindowDrag();

	return (
		// Translucent over the native vibrancy — the frosted-glass chrome.
		// No border-r: the ResizableHandle already draws the 1px divider.
		<aside
			className="flex h-full flex-col bg-sidebar/50 text-sidebar-foreground windows:bg-sidebar"
			onPointerDown={windowDrag.onPointerDown}
		>
			{/* Overlay titlebar: top inset clears the macOS traffic lights. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: window-chrome zoom gesture (double-click titlebar), not content interaction */}
			<header
				className="shrink-0 px-2 pt-8 pb-1"
				onDoubleClick={windowDrag.onDoubleClick}
			>
				<LibrarySwitcher />
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-3 px-2 pt-1">
				<SmartViews />
				<DiscoverNav />
				<SmartFolderList />
				<FolderTree filter={filter} />
				<TagList />
			</div>
			<footer className="shrink-0 border-sidebar-border/60 border-t p-2">
				<div className="relative">
					<IconFilter className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
					<Input
						className="h-8 pl-8"
						placeholder={T.sidebar.filterPlaceholder}
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
					/>
				</div>
			</footer>
		</aside>
	);
}
