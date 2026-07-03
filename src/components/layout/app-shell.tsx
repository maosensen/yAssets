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
import { InspectorPanel } from "@/components/inspector/inspector-panel";
import { FolderTree } from "@/components/sidebar/folder-tree";
import { LibrarySwitcher } from "@/components/sidebar/library-switcher";
import { SmartViews } from "@/components/sidebar/smart-views";
import { TagList } from "@/components/sidebar/tag-list";
import { Input } from "@/components/ui/input";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useDragImport } from "@/hooks/use-drag-import";
import { useImport, useImportEvents } from "@/hooks/use-import";
import { useWindowDrag } from "@/hooks/use-window-drag";
import { T } from "@/lib/text";

export function AppShell() {
	useImportEvents();
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const { importPaths } = useImport();
	const dropFolderId =
		search?.view === "folder" ? (search.folderId ?? null) : null;
	const { isDragOver } = useDragImport((paths) =>
		importPaths(paths, dropFolderId),
	);

	return (
		<div className="flex h-screen flex-col">
			<DropOverlay visible={isDragOver} />
			<DragGhost />
			<ResizablePanelGroup className="min-h-0 flex-1">
				<ResizablePanel defaultSize="260px" minSize="200px" maxSize="420px">
					<Sidebar />
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel minSize="320px">
					{/* Content column stays solid — thumbnails need stable ground. */}
					<main className="h-full min-w-0 overflow-hidden bg-background">
						<Outlet />
					</main>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel defaultSize="280px" minSize="240px" maxSize="420px">
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
			className="flex h-full flex-col bg-sidebar/50 text-sidebar-foreground"
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
