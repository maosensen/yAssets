/**
 * Inspector body for a folder view — Eagle-style folder info panel: name,
 * editable description, a properties table (Items / Size / Date Imported), and
 * an Export action over the folder's direct assets. Rendered by FolderSummary
 * when nothing is selected and the current view is a folder.
 *
 * Plain controlled state + a debounced description save — mirrors the asset
 * inspector; no form library.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { IconFolder } from "@/components/icons";
import { DashedDivider, SectionLabel } from "@/components/inspector/section";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useExport } from "@/hooks/use-export";
import type { Folder } from "@/lib/bindings";
import { formatBytes, formatDateTime } from "@/lib/format";
import { assetListQueryOptions } from "@/lib/queries/assets";
import {
	folderStatsQueryOptions,
	useSetFolderDescription,
} from "@/lib/queries/folders";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";

export function FolderDetails({ folder }: { folder: Folder }) {
	// key: hard-reset field state when switching folders.
	return <FolderBody key={folder.id} folder={folder} />;
}

function FolderBody({ folder }: { folder: Folder }) {
	const { data: stats } = useQuery(folderStatsQueryOptions(folder.id));
	const { exportAssets, isExporting } = useExport();
	const queryClient = useQueryClient();
	const sort = useViewPrefsStore((state) => state.sort);
	const dir = useViewPrefsStore((state) => state.dir);

	const itemCount = stats?.item_count ?? folder.asset_count;

	const onExport = async () => {
		// Resolve the folder's direct assets on demand (shares the grid's cache
		// entry when the folder is being viewed), then export.
		const list = await queryClient.fetchQuery(
			assetListQueryOptions({
				scope: { kind: "folder", folder_id: folder.id },
				sort,
				dir,
			}),
		);
		await exportAssets(list.items.map((asset) => asset.id));
	};

	return (
		// Inspector column anatomy: scrollable main + fixed action footer.
		<div className="flex h-full flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				<section className="flex flex-col gap-3">
					<div className="flex items-center gap-2">
						<IconFolder className="size-5 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate font-medium text-sm">
							{folder.name}
						</span>
					</div>
					<FolderDescriptionField folder={folder} />
				</section>

				<DashedDivider />

				<div className="flex flex-col gap-2.5">
					<SectionLabel>{T.inspector.infoTitle}</SectionLabel>
					<dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-xs">
						<InfoRow
							label={T.inspector.folderItems}
							value={T.inspector.itemCount(itemCount)}
						/>
						<InfoRow
							label={T.inspector.infoSize}
							value={formatBytes(stats?.total_size ?? 0)}
						/>
						<InfoRow
							label={T.inspector.infoImported}
							value={formatDateTime(folder.created_at)}
						/>
					</dl>
				</div>
			</div>
			<footer className="flex shrink-0 gap-2 border-t p-3">
				<Button
					variant="outline"
					size="sm"
					className="flex-1"
					disabled={isExporting || itemCount === 0}
					onClick={() => void onExport()}
				>
					{T.inspector.exportAction}
				</Button>
			</footer>
		</div>
	);
}

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="contents">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="truncate text-right tabular-nums">{value}</dd>
		</div>
	);
}

function FolderDescriptionField({ folder }: { folder: Folder }) {
	const setDescription = useSetFolderDescription();
	const [value, setValue] = useState(folder.description ?? "");
	const debounced = useDebouncedValue(value, 800);

	// Debounced autosave. Compare/send the TRIMMED value — the backend trims
	// before storing, so comparing trimmed makes the server echo converge
	// (otherwise whitespace-padded input triggers a redundant second write).
	useEffect(() => {
		const trimmed = debounced.trim();
		if (trimmed !== (folder.description ?? "")) {
			setDescription.mutate({ id: folder.id, description: trimmed });
		}
	}, [debounced, folder.id, folder.description, setDescription.mutate]);

	return (
		<Textarea
			value={value}
			placeholder={T.inspector.folderDescPlaceholder}
			className="min-h-16 resize-none text-sm"
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => {
				const trimmed = value.trim();
				if (trimmed !== (folder.description ?? "")) {
					setDescription.mutate({ id: folder.id, description: trimmed });
				}
			}}
		/>
	);
}
