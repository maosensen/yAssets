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

	return (
		// Translucent over the native vibrancy — the frosted-glass chrome.
		// No border-r: the ResizableHandle already draws the 1px divider.
		<aside className="flex h-full flex-col bg-sidebar/50 text-sidebar-foreground">
			{/* Overlay titlebar: top inset clears the macOS traffic lights;
			    the header doubles as the window drag strip. */}
			<header className="shrink-0 px-2 pt-8 pb-1" data-tauri-drag-region>
				<LibrarySwitcher />
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-2 px-2">
				<SmartViews />
				<FolderTree filter={filter} />
				<TagList />
			</div>
			<footer className="shrink-0 border-sidebar-border/60 border-t p-2">
				<Input
					placeholder={T.sidebar.filterPlaceholder}
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
				/>
			</footer>
		</aside>
	);
}
