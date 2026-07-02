/**
 * The three-pane shell: sidebar | main (route outlet) | inspector.
 *
 * Rendered by the `_library` layout route, so a library is guaranteed open.
 * Native drag-drop imports into the folder currently in view.
 */

import { Outlet, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { DropOverlay } from "@/components/import/drop-overlay";
import { InspectorPanel } from "@/components/inspector/inspector-panel";
import { FolderTree } from "@/components/sidebar/folder-tree";
import { LibrarySwitcher } from "@/components/sidebar/library-switcher";
import { SmartViews } from "@/components/sidebar/smart-views";
import { Input } from "@/components/ui/input";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useDragImport } from "@/hooks/use-drag-import";
import { useImport, useImportEvents } from "@/hooks/use-import";
import { T } from "@/lib/text";
import { Toolbar } from "./toolbar";

export function AppShell() {
	useImportEvents();
	const search = useSearch({ from: "/_library/" });
	const { importPaths } = useImport();
	const dropFolderId =
		search.view === "folder" ? (search.folderId ?? null) : null;
	const { isDragOver } = useDragImport((paths) =>
		importPaths(paths, dropFolderId),
	);

	return (
		<div className="flex h-screen flex-col">
			<Toolbar />
			<DropOverlay visible={isDragOver} />
			<ResizablePanelGroup className="min-h-0 flex-1">
				<ResizablePanel defaultSize="260px" minSize="200px" maxSize="420px">
					<Sidebar />
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel minSize="320px">
					<main className="h-full min-w-0 overflow-hidden">
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

function Sidebar() {
	const [filter, setFilter] = useState("");

	return (
		<aside className="flex h-full flex-col gap-2 border-r bg-sidebar p-2 text-sidebar-foreground">
			<LibrarySwitcher />
			<SmartViews />
			<FolderTree filter={filter} />
			<Input
				placeholder={T.sidebar.filterPlaceholder}
				value={filter}
				onChange={(event) => setFilter(event.target.value)}
			/>
		</aside>
	);
}
