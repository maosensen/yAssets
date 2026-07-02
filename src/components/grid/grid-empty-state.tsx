/** Empty library view: drop hint + explicit import entry points. */

import { FolderInput, ImagePlus, ImageUp } from "lucide-react";
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
		<div className="flex h-full flex-col items-center justify-center gap-6 p-8">
			<div className="flex flex-col items-center gap-2 text-center">
				<ImageUp className="size-12 text-muted-foreground/50" />
				<h2 className="font-medium text-lg">{T.grid.emptyTitle}</h2>
				<p className="text-muted-foreground text-sm">{T.grid.emptyHint}</p>
			</div>
			<div className="flex gap-3">
				<Button variant="outline" onClick={onImportFiles} disabled={importing}>
					<ImagePlus className="size-4" />
					{T.import.importFiles}
				</Button>
				<Button variant="outline" onClick={onImportFolder} disabled={importing}>
					<FolderInput className="size-4" />
					{T.import.importFolder}
				</Button>
			</div>
		</div>
	);
}
