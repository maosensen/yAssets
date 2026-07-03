/**
 * Duplicate File Alert — Eagle-style resolution dialog for library-wide
 * exact duplicates reported by an import job.
 *
 * Both sides render the EXISTING asset's thumbnail (blake3-identical bytes =
 * identical pixels); the incoming card is dimmed with an "Imported" badge.
 * "Use existing files" keeps the catalog as-is (the pipeline already attached
 * folder membership); "Keep both" re-imports the same paths with dedupe
 * disabled. Mounted once in AppShell; opens whenever a job raises duplicates.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useImport } from "@/hooks/use-import";
import type { DuplicateItem } from "@/lib/bindings";
import { formatBytes, formatDimensions } from "@/lib/format";
import { thumbUrl } from "@/lib/media";
import { assetDetailQueryOptions } from "@/lib/queries/assets";
import { useDuplicatesStore } from "@/lib/stores/duplicates-store";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

type Strategy = "use-existing" | "keep-both";

export function DuplicateAlertDialog() {
	const pending = useDuplicatesStore((state) => state.pending);
	const clear = useDuplicatesStore((state) => state.clear);

	return (
		<Dialog open={pending !== null} onOpenChange={(open) => !open && clear()}>
			{pending && (
				// key: reset the strategy choice per raised job.
				<AlertBody key={pending.jobId} />
			)}
		</Dialog>
	);
}

function AlertBody() {
	const pending = useDuplicatesStore((state) => state.pending);
	const clear = useDuplicatesStore((state) => state.clear);
	const { importPaths } = useImport();
	const [strategy, setStrategy] = useState<Strategy>("use-existing");

	if (!pending) return null;
	const { items, folderId } = pending;

	const confirm = () => {
		if (strategy === "keep-both") {
			importPaths(
				items.map((item) => item.src_path),
				folderId,
				{ keepDuplicates: true },
			);
		}
		clear();
	};

	return (
		<DialogContent className="max-w-xl">
			<DialogHeader>
				<DialogTitle>{T.duplicates.title(items.length)}</DialogTitle>
			</DialogHeader>
			<p className="text-muted-foreground text-sm">{T.duplicates.hint}</p>

			<div className="flex max-h-96 flex-col gap-5 overflow-y-auto pr-1">
				{items.map((item) => (
					<DuplicatePair
						key={`${item.existing_id}:${item.src_path}`}
						item={item}
					/>
				))}
			</div>

			<DialogFooter className="items-center gap-4 sm:justify-between">
				<div className="flex items-center gap-4">
					<StrategyRadio
						label={T.duplicates.useExisting}
						checked={strategy === "use-existing"}
						onSelect={() => setStrategy("use-existing")}
					/>
					<StrategyRadio
						label={T.duplicates.keepBoth}
						checked={strategy === "keep-both"}
						onSelect={() => setStrategy("keep-both")}
					/>
				</div>
				<Button onClick={confirm}>{T.duplicates.importAction}</Button>
			</DialogFooter>
		</DialogContent>
	);
}

function StrategyRadio({
	label,
	checked,
	onSelect,
}: {
	label: string;
	checked: boolean;
	onSelect: () => void;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-1.5 text-sm">
			<input
				type="radio"
				name="duplicate-strategy"
				className="accent-primary"
				checked={checked}
				onChange={onSelect}
			/>
			{label}
		</label>
	);
}

/** Existing vs. incoming, side by side — same thumbnail, different fate. */
function DuplicatePair({ item }: { item: DuplicateItem }) {
	const { data: existing } = useQuery(
		assetDetailQueryOptions(item.existing_id),
	);

	const dims = existing
		? formatDimensions(existing.width, existing.height)
		: null;
	const existingMeta = existing
		? `${dims ? `${dims} / ` : ""}${formatBytes(existing.size ?? 0)}`
		: "";
	// f64 exports as number|null (non-finite floats serialize to null).
	const incomingMeta = `${dims ? `${dims} / ` : ""}${formatBytes(item.size ?? 0)}`;
	const incomingFile = item.src_path.split("/").pop() ?? item.name;

	return (
		<div className="grid grid-cols-2 gap-4">
			<SideCard
				assetId={item.existing_id}
				badge={T.duplicates.existing}
				badgeClass="bg-black/60 text-white"
				name={existing?.name ?? item.name}
				meta={existingMeta}
			/>
			<SideCard
				assetId={item.existing_id}
				badge={T.duplicates.incoming}
				badgeClass="bg-primary/80 text-primary-foreground"
				name={incomingFile}
				meta={incomingMeta}
				dimmed
			/>
		</div>
	);
}

function SideCard({
	assetId,
	badge,
	badgeClass,
	name,
	meta,
	dimmed,
}: {
	assetId: string;
	badge: string;
	badgeClass: string;
	name: string;
	meta: string;
	dimmed?: boolean;
}) {
	return (
		<div className="flex min-w-0 flex-col items-center gap-1">
			<div
				className={cn(
					"relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-muted",
					dimmed && "opacity-60",
				)}
			>
				<img
					src={thumbUrl(assetId)}
					alt={name}
					className="max-h-full max-w-full object-contain"
					draggable={false}
				/>
				<span
					className={cn(
						"absolute rounded-md px-2.5 py-1 font-medium text-xs",
						badgeClass,
					)}
				>
					{badge}
				</span>
			</div>
			<span className="w-full truncate text-center text-xs" title={name}>
				{name}
			</span>
			<span className="text-[11px] text-muted-foreground tabular-nums">
				{meta}
			</span>
		</div>
	);
}
