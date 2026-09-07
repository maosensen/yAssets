/**
 * Duplicates center — whole-library scan report (Library menu ▸ Find
 * Duplicates…).
 *
 * Exact groups (byte-identical) clean mechanically: keep the earliest
 * import, soft-delete the rest. Visual clusters (dHash look-alikes across
 * different files) only offer "Compare", which jumps into the ranked
 * similar view — deleting look-alikes is a judgement call, not a button.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { EmptyState } from "@/components/empty-state";
import { IconCopy, IconReload } from "@/components/icons";
import { DashedDivider, SectionLabel } from "@/components/inspector/section";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { type AssetSummary, commands } from "@/lib/bindings";
import { formatBytes } from "@/lib/format";
import { thumbUrl } from "@/lib/media";
import { useTrashAssets } from "@/lib/queries/assets";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";

export function DuplicatesDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const trashMutation = useTrashAssets();
	const { data, isFetching, refetch } = useQuery({
		queryKey: ["duplicates", "scan"],
		queryFn: async () => unwrap(await commands.scanDuplicates()),
		enabled: open,
		staleTime: 0,
	});

	const trashDupes = (ids: string[]) => {
		if (ids.length === 0) return;
		trashMutation.mutate(ids, { onSuccess: () => void refetch() });
	};
	// Every non-first member of every exact group.
	const allExactDupes =
		data?.exact.flatMap((group) => group.slice(1).map((a) => a.id)) ?? [];

	const compare = (id: string) => {
		onOpenChange(false);
		void navigate({ to: "/", search: { view: "similar", similarTo: id } });
	};

	const isEmpty =
		data !== undefined && data.exact.length === 0 && data.visual.length === 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
				<DialogHeader>
					<DialogTitle className="flex items-center justify-between gap-3 pr-6">
						{T.duplicatesCenter.title}
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-muted-foreground text-xs"
							disabled={isFetching}
							onClick={() => void refetch()}
						>
							<IconReload className="size-3.5" />
							{T.duplicatesCenter.rescan}
						</Button>
					</DialogTitle>
				</DialogHeader>

				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					{!data ? (
						<div className="flex h-40 items-center justify-center">
							<span className="text-muted-foreground text-sm">
								{T.duplicatesCenter.scanning}
							</span>
						</div>
					) : isEmpty ? (
						<EmptyState
							variant="panel"
							className="h-auto py-10"
							icon={IconCopy}
							title={T.duplicatesCenter.empty.title}
							hint={T.duplicatesCenter.empty.hint}
						/>
					) : (
						<div className="flex flex-col gap-3">
							{data.exact.length > 0 && (
								<section className="flex flex-col gap-2">
									<SectionLabel>
										{T.duplicatesCenter.exactSection(data.exact.length)}
									</SectionLabel>
									<p className="text-muted-foreground text-xs">
										{T.duplicatesCenter.exactHint}
									</p>
									{data.exact.map((group) => (
										<GroupRow
											key={group[0]?.id}
											group={group}
											action={
												<Button
													variant="outline"
													size="sm"
													className="shrink-0 text-destructive"
													disabled={trashMutation.isPending}
													onClick={() =>
														trashDupes(group.slice(1).map((a) => a.id))
													}
												>
													{T.duplicatesCenter.trashOthers(group.length - 1)}
												</Button>
											}
										/>
									))}
								</section>
							)}

							{data.exact.length > 0 && data.visual.length > 0 && (
								<DashedDivider className="my-1" />
							)}

							{data.visual.length > 0 && (
								<section className="flex flex-col gap-2">
									<SectionLabel>
										{T.duplicatesCenter.visualSection(data.visual.length)}
									</SectionLabel>
									<p className="text-muted-foreground text-xs">
										{T.duplicatesCenter.visualHint}
									</p>
									{data.visual.map((group) => (
										<GroupRow
											key={group[0]?.id}
											group={group}
											action={
												<Button
													variant="outline"
													size="sm"
													className="shrink-0"
													onClick={() => {
														const first = group[0];
														if (first) compare(first.id);
													}}
												>
													{T.duplicatesCenter.compare}
												</Button>
											}
										/>
									))}
								</section>
							)}
						</div>
					)}
				</div>

				{allExactDupes.length > 0 && (
					<DialogFooter>
						<Button
							variant="outline"
							className="text-destructive"
							disabled={trashMutation.isPending}
							onClick={() => trashDupes(allExactDupes)}
						>
							{T.duplicatesCenter.trashAll(allExactDupes.length)}
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

/**
 * One duplicate group: thumbnail strip + name/meta + the group action.
 *
 * Width priority, in the order the row gives ground: thumbnails first, then
 * the name, and the button never. That order is deliberate — the button says
 * how many files it is about to trash, so a clipped label is the one thing
 * this row must not produce, and for an exact group every thumbnail in the
 * strip is the *same image* anyway (that's what byte-identical means), so
 * losing the fourth one costs nothing.
 *
 * Getting there needs three things, and dropping any one of them collapses
 * the row: the strip shrinks and clips (it used to be `shrink-0`, which made
 * the name column the only thing that could yield, so the name vanished
 * first); the name column carries a real flex-basis so it has standing in the
 * shrink calculation instead of a basis of 0 that can only ever grow into
 * leftovers; and both text lines truncate, or the meta reflows into a
 * one-word-per-line stack ("9 / files / · / 13.9 / MB") on its way down.
 */
function GroupRow({
	group,
	action,
}: {
	group: AssetSummary[];
	action: React.ReactNode;
}) {
	const first = group[0];
	if (!first) return null;
	const shown = group.slice(0, 4);
	const extra = group.length - shown.length;
	const totalSize = group.reduce((sum, a) => sum + (a.size ?? 0), 0);

	return (
		<div className="flex items-center gap-3 rounded-md border border-border/60 p-2">
			<div className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
				{shown.map((asset) => (
					<div
						key={asset.id}
						className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted"
					>
						{asset.has_thumb ? (
							<img
								src={thumbUrl(asset.id)}
								alt={asset.name}
								className="max-h-full max-w-full object-contain"
								draggable={false}
								loading="lazy"
							/>
						) : (
							<span className="px-1 text-[10px] text-muted-foreground uppercase">
								{asset.ext || "?"}
							</span>
						)}
					</div>
				))}
			</div>
			{/* Outside the clipping strip: the count of what you can't see is
			    the last thing that should be clipped away. */}
			{extra > 0 && (
				<span className="shrink-0 text-muted-foreground text-xs">+{extra}</span>
			)}
			<div className="min-w-0 flex-[1_1_8rem]">
				<p className="truncate text-sm" title={first.name}>
					{first.name}
				</p>
				<p className="truncate text-muted-foreground text-xs tabular-nums">
					{T.duplicatesCenter.filesMeta(group.length, formatBytes(totalSize))}
				</p>
			</div>
			{action}
		</div>
	);
}
