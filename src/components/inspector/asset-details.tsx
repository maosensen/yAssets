/**
 * Inspector for the selected asset: preview, rename, rating, debounced note
 * autosave, folder membership chips, info table, reveal/export actions.
 *
 * Plain controlled state + mutations — no form library: these are
 * independent, instantly-committing fields (react-hook-form would be pure
 * overhead here; zod stays reserved for route search validation).
 */

import { useQuery } from "@tanstack/react-query";
import {
	Folder as FolderIcon,
	Plus,
	SquareArrowOutUpRight,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RatingStars } from "@/components/inspector/rating-stars";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { AssetDetail } from "@/lib/bindings";
import { buildFolderTree, flattenFolderTree } from "@/lib/folder-tree";
import { formatBytes, formatDateTime, formatDimensions } from "@/lib/format";
import { thumbUrl } from "@/lib/media";
import {
	assetDetailQueryOptions,
	revealAsset,
	useUpdateAsset,
} from "@/lib/queries/assets";
import {
	foldersQueryOptions,
	useAddAssetsToFolder,
	useRemoveAssetsFromFolder,
} from "@/lib/queries/folders";
import { T } from "@/lib/text";

export function AssetDetails({ assetId }: { assetId: string }) {
	const { data: detail } = useQuery(assetDetailQueryOptions(assetId));
	if (!detail) return null;
	// key: hard-reset all field state when switching assets.
	return <DetailsBody key={detail.id} detail={detail} />;
}

function DetailsBody({ detail }: { detail: AssetDetail }) {
	const update = useUpdateAsset();

	return (
		// Inspector column anatomy: scrollable main + fixed action footer.
		<div className="flex h-full flex-col">
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
				<PreviewBox detail={detail} />
				<NameField detail={detail} />
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground text-xs">
						{T.inspector.ratingLabel}
					</span>
					<RatingStars
						value={detail.rating ?? 0}
						onChange={(rating) =>
							update.mutate({ id: detail.id, patch: { rating } })
						}
					/>
				</div>
				<NoteField detail={detail} />
				<FolderChips detail={detail} />
				<InfoTable detail={detail} />
				{/* 标签区（二阶段）：tags/asset_tags 表已在 schema v1 预留 */}
			</div>
			<footer className="flex shrink-0 gap-2 border-t p-3">
				<Button
					variant="outline"
					size="sm"
					className="flex-1"
					onClick={() => revealAsset(detail.id)}
				>
					<SquareArrowOutUpRight className="size-3.5" />
					{T.assetMenu.reveal}
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="flex-1"
					disabled
					title={T.inspector.exportSoon}
				>
					{T.inspector.exportAction}
				</Button>
			</footer>
		</div>
	);
}

function PreviewBox({ detail }: { detail: AssetDetail }) {
	const [broken, setBroken] = useState(false);
	return (
		<div className="flex max-h-48 min-h-24 items-center justify-center overflow-hidden rounded-md bg-muted">
			{detail.has_thumb && !broken ? (
				<img
					src={thumbUrl(detail.id)}
					alt={detail.name}
					className="max-h-48 max-w-full object-contain"
					draggable={false}
					onError={() => setBroken(true)}
				/>
			) : (
				<span className="rounded bg-background/70 px-3 py-1.5 font-medium text-muted-foreground text-sm uppercase">
					{detail.ext || "?"}
				</span>
			)}
		</div>
	);
}

function NameField({ detail }: { detail: AssetDetail }) {
	const update = useUpdateAsset();
	const [name, setName] = useState(detail.name);
	useEffect(() => setName(detail.name), [detail.name]);

	const commit = () => {
		const trimmed = name.trim();
		if (!trimmed || trimmed === detail.name) {
			setName(detail.name);
			return;
		}
		update.mutate({ id: detail.id, patch: { name: trimmed } });
	};

	return (
		<Input
			value={name}
			onChange={(event) => setName(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") setName(detail.name);
			}}
		/>
	);
}

function NoteField({ detail }: { detail: AssetDetail }) {
	const update = useUpdateAsset();
	const [note, setNote] = useState(detail.note);
	const debouncedNote = useDebouncedValue(note, 800);

	// Debounced autosave. Safe under full deps: after a save the server echo
	// makes `detail.note === debouncedNote`, so the re-run is a no-op
	// (`mutate` itself is referentially stable).
	useEffect(() => {
		if (debouncedNote !== detail.note) {
			update.mutate({ id: detail.id, patch: { note: debouncedNote } });
		}
	}, [debouncedNote, detail.id, detail.note, update.mutate]);

	return (
		<Textarea
			value={note}
			placeholder={T.inspector.notePlaceholder}
			className="min-h-16 resize-none text-sm"
			onChange={(event) => setNote(event.target.value)}
			onBlur={() => {
				// Flush immediately on blur.
				if (note !== detail.note) {
					update.mutate({ id: detail.id, patch: { note } });
				}
			}}
		/>
	);
}

function FolderChips({ detail }: { detail: AssetDetail }) {
	const { data: folders } = useQuery(foldersQueryOptions());
	const addMutation = useAddAssetsToFolder();
	const removeMutation = useRemoveAssetsFromFolder();

	const nameById = useMemo(
		() => new Map((folders ?? []).map((folder) => [folder.id, folder.name])),
		[folders],
	);
	const candidates = useMemo(() => {
		const memberIds = new Set(detail.folder_ids);
		return flattenFolderTree(buildFolderTree(folders ?? [])).filter(
			({ node }) => !memberIds.has(node.id),
		);
	}, [folders, detail.folder_ids]);

	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-muted-foreground text-xs">
				{T.inspector.foldersLabel}
			</span>
			<div className="flex flex-wrap items-center gap-1.5">
				{detail.folder_ids.map((folderId) => (
					<span
						key={folderId}
						className="group flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
					>
						<FolderIcon className="size-3 text-muted-foreground" />
						<span className="max-w-32 truncate">
							{nameById.get(folderId) ?? folderId}
						</span>
						<button
							type="button"
							aria-label={T.inspector.removeFromThisFolder}
							className="text-muted-foreground opacity-60 hover:opacity-100"
							onClick={() =>
								removeMutation.mutate({
									assetIds: [detail.id],
									folderId,
								})
							}
						>
							<X className="size-3" />
						</button>
					</span>
				))}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="outline"
								size="sm"
								className="h-6 px-2 text-xs"
							/>
						}
					>
						<Plus className="size-3" />
						{T.inspector.addToFolder}
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						{candidates.length === 0 ? (
							<DropdownMenuItem disabled>
								{T.assetMenu.noFolders}
							</DropdownMenuItem>
						) : (
							candidates.map(({ node, depth }) => (
								<DropdownMenuItem
									key={node.id}
									style={{ paddingLeft: 8 + depth * 12 }}
									onClick={() =>
										addMutation.mutate({
											assetIds: [detail.id],
											folderId: node.id,
										})
									}
								>
									{node.name}
								</DropdownMenuItem>
							))
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

function InfoTable({ detail }: { detail: AssetDetail }) {
	const rows: Array<[string, string]> = [
		[
			T.inspector.infoDimensions,
			formatDimensions(detail.width, detail.height) ?? "—",
		],
		[T.inspector.infoSize, formatBytes(detail.size ?? 0)],
		[
			T.inspector.infoFormat,
			detail.ext ? detail.ext.toUpperCase() : (detail.mime ?? "—"),
		],
		[T.inspector.infoImported, formatDateTime(detail.imported_at)],
		[T.inspector.infoCreated, formatDateTime(detail.file_ctime)],
		[T.inspector.infoModified, formatDateTime(detail.file_mtime)],
	];

	return (
		<div className="flex flex-col gap-1">
			<span className="text-muted-foreground text-xs">
				{T.inspector.infoTitle}
			</span>
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
				{rows.map(([label, value]) => (
					<div key={label} className="contents">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className="truncate text-right tabular-nums">{value}</dd>
					</div>
				))}
				{detail.src_path && (
					<div className="contents">
						<dt className="text-muted-foreground">{T.inspector.infoSource}</dt>
						<dd
							className="truncate text-right text-muted-foreground"
							title={detail.src_path}
						>
							{detail.src_path}
						</dd>
					</div>
				)}
			</dl>
		</div>
	);
}
