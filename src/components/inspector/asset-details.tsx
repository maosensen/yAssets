/**
 * Inspector for the selected asset — Eagle-style anatomy, top to bottom:
 * badged preview → extracted-color dots → name + notes fields → tags /
 * folders → properties table (rating lives in its first row) → action footer.
 *
 * Layout rhythm: major modules are separated by dashed dividers, properties
 * keep generous row spacing — see `section.tsx` for the shared primitives.
 *
 * Plain controlled state + mutations — no form library: these are
 * independent, instantly-committing fields (react-hook-form would be pure
 * overhead here; zod stays reserved for route search validation).
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	IconClose,
	IconFolder,
	IconPlus,
	IconReveal,
} from "@/components/icons";
import { RatingStars } from "@/components/inspector/rating-stars";
import { DashedDivider, SectionLabel } from "@/components/inspector/section";
import { TagChips } from "@/components/inspector/tag-chips";
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
import { useExport } from "@/hooks/use-export";
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
import { useUiStore } from "@/lib/stores/ui-store";
import { T } from "@/lib/text";

export function AssetDetails({ assetId }: { assetId: string }) {
	const { data: detail } = useQuery(assetDetailQueryOptions(assetId));
	if (!detail) return null;
	// key: hard-reset all field state when switching assets.
	return <DetailsBody key={detail.id} detail={detail} />;
}

function DetailsBody({ detail }: { detail: AssetDetail }) {
	const { exportAssets, isExporting } = useExport();

	return (
		// Inspector column anatomy: scrollable main + fixed action footer.
		<div className="flex h-full flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				{/* Identity: badged preview + colors + name + notes */}
				<section className="flex flex-col gap-3">
					<PreviewBox detail={detail} />
					{detail.palette.length > 0 && <PaletteDots colors={detail.palette} />}
					<NameField detail={detail} />
					<NoteField detail={detail} />
				</section>

				<DashedDivider />

				{/* Organization: tags + folders */}
				<section className="flex flex-col gap-4">
					<TagChips assetIds={[detail.id]} tags={detail.tags} />
					<FolderChips detail={detail} />
				</section>

				<DashedDivider />

				<InfoTable detail={detail} />
			</div>
			<footer className="flex shrink-0 gap-2 border-t p-3">
				<Button
					variant="outline"
					size="sm"
					className="flex-1"
					onClick={() => revealAsset(detail.id)}
				>
					<IconReveal className="size-3.5" />
					{T.assetMenu.reveal}
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="flex-1"
					disabled={isExporting}
					onClick={() => void exportAssets([detail.id])}
				>
					{T.inspector.exportAction}
				</Button>
			</footer>
		</div>
	);
}

function PreviewBox({ detail }: { detail: AssetDetail }) {
	const [broken, setBroken] = useState(false);
	const showImage = detail.has_thumb && !broken;
	return (
		<div className="relative flex max-h-48 min-h-24 items-center justify-center overflow-hidden rounded-md bg-muted">
			{showImage ? (
				<>
					<img
						src={thumbUrl(detail.id)}
						alt={detail.name}
						className="max-h-48 max-w-full object-contain"
						draggable={false}
						onError={() => setBroken(true)}
					/>
					{detail.ext && (
						// Eagle-style format badge in the preview corner.
						<span className="absolute top-1.5 left-1.5 rounded-sm bg-black/55 px-1.5 py-0.5 font-medium text-[10px] text-white uppercase tracking-wide">
							{detail.ext}
						</span>
					)}
				</>
			) : (
				<span className="rounded-sm bg-background/70 px-3 py-1.5 font-medium text-muted-foreground text-sm uppercase">
					{detail.ext || "?"}
				</span>
			)}
		</div>
	);
}

/** Extracted dominant colors as a centered row of dots (Eagle-style). */
function PaletteDots({ colors }: { colors: string[] }) {
	return (
		<div className="flex items-center justify-center gap-2">
			{colors.map((color) => (
				<span
					key={color}
					className="size-6 rounded-full border border-foreground/10"
					style={{ backgroundColor: color }}
					title={color}
				/>
			))}
		</div>
	);
}

function NameField({ detail }: { detail: AssetDetail }) {
	const update = useUpdateAsset();
	const [name, setName] = useState(detail.name);
	useEffect(() => setName(detail.name), [detail.name]);

	// Enter/F2 on a selected card bumps the rename signal → grab focus.
	const renameSignal = useUiStore((state) => state.renameSignal);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const seenSignal = useRef(renameSignal);
	useEffect(() => {
		if (renameSignal === seenSignal.current) return;
		seenSignal.current = renameSignal;
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [renameSignal]);

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
			ref={inputRef}
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
		<div className="flex flex-col gap-2">
			<SectionLabel>{T.inspector.foldersLabel}</SectionLabel>
			<div className="flex flex-wrap items-center gap-1.5">
				{detail.folder_ids.map((folderId) => (
					<span
						key={folderId}
						className="group flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
					>
						<IconFolder className="size-3 text-muted-foreground" />
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
							<IconClose className="size-3" />
						</button>
					</span>
				))}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon"
								className="size-6 text-muted-foreground"
								aria-label={T.inspector.addToFolder}
							/>
						}
					>
						<IconPlus className="size-4" />
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
	const update = useUpdateAsset();
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
		<div className="flex flex-col gap-2.5">
			<SectionLabel>{T.inspector.infoTitle}</SectionLabel>
			<dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-xs">
				{/* Rating leads the properties table (Eagle layout). */}
				<div className="contents">
					<dt className="text-muted-foreground">{T.inspector.ratingLabel}</dt>
					<dd className="flex justify-end">
						<RatingStars
							value={detail.rating ?? 0}
							onChange={(rating) =>
								update.mutate({ id: detail.id, patch: { rating } })
							}
						/>
					</dd>
				</div>
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
