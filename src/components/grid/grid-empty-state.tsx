/** Empty library view: drop hint + explicit import entry points. */

import { EmptyState } from "@/components/empty-state";
import { IconFolderImport, IconImportImages } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { T } from "@/lib/text";

type GridEmptyStateProps = {
	importing: boolean;
	onImportFiles: () => void;
	onImportFolder: () => void;
};

export function GridEmptyState({
	importing,
	onImportFiles,
	onImportFolder,
}: GridEmptyStateProps) {
	return (
		<EmptyState
			icon={IconImportImages}
			title={T.grid.emptyTitle}
			hint={T.grid.emptyHint}
		>
			<Button variant="outline" onClick={onImportFiles} disabled={importing}>
				<IconImportImages className="size-4" />
				{T.import.importFiles}
			</Button>
			<Button variant="outline" onClick={onImportFolder} disabled={importing}>
				<IconFolderImport className="size-4" />
				{T.import.importFolder}
			</Button>
		</EmptyState>
	);
}
