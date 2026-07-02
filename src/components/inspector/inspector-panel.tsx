/**
 * Right pane router: single selection → asset details; otherwise the
 * current-view summary. (Multi-select batch panel is a phase-2 concern.)
 */

import { useSelectionStore } from "@/lib/stores/selection-store";
import { AssetDetails } from "./asset-details";
import { FolderSummary } from "./folder-summary";

export function InspectorPanel() {
	const selectedIds = useSelectionStore((state) => state.selectedIds);
	const singleId = selectedIds.size === 1 ? [...selectedIds][0] : undefined;

	return (
		<aside className="h-full border-l">
			{singleId ? <AssetDetails assetId={singleId} /> : <FolderSummary />}
		</aside>
	);
}
