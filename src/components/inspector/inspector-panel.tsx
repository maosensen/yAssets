/**
 * Right pane router: single selection → asset details; otherwise the
 * current-view summary. (Multi-select batch panel is a phase-2 concern.)
 */

import { useSelectionStore } from "@/lib/stores/selection-store";
import { AssetDetails } from "./asset-details";
import { FolderSummary } from "./folder-summary";
import { MultiSummary } from "./multi-summary";

export function InspectorPanel() {
	const selectedIds = useSelectionStore((state) => state.selectedIds);

	return (
		// Translucent over the native vibrancy, matching the sidebar chrome.
		// No border-l: the ResizableHandle already draws the 1px divider.
		<aside className="h-full bg-sidebar/50">
			{selectedIds.size === 1 ? (
				<AssetDetails assetId={[...selectedIds][0]} />
			) : selectedIds.size > 1 ? (
				<MultiSummary ids={[...selectedIds]} />
			) : (
				<FolderSummary />
			)}
		</aside>
	);
}
