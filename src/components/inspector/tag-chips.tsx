/**
 * Tag chips + picker for the inspector. The picker is a Popover'd Command:
 * search existing tags, or type a new name and create-and-attach in one
 * stroke (Eagle's type-to-tag flow).
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { IconClose, IconPlus } from "@/components/icons";
import { SectionLabel } from "@/components/inspector/section";
import { TagDot } from "@/components/sidebar/tag-list";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { TagRef } from "@/lib/bindings";
import {
	tagsQueryOptions,
	useAddTagsToAssets,
	useRemoveTagsFromAssets,
	useTagAssetsByName,
} from "@/lib/queries/tags";
import { T } from "@/lib/text";

type TagChipsProps = {
	/** One id = inspector detail; many = batch tagging (chips hidden). */
	assetIds: string[];
	/** Attached tags to render as chips (single-asset mode only). */
	tags?: TagRef[];
};

export function TagChips({ assetIds, tags = [] }: TagChipsProps) {
	const [open, setOpen] = useState(false);
	const [term, setTerm] = useState("");
	const { data: allTags } = useQuery(tagsQueryOptions());
	const addMutation = useAddTagsToAssets();
	const removeMutation = useRemoveTagsFromAssets();
	const tagByName = useTagAssetsByName();

	const attachedIds = useMemo(() => new Set(tags.map((tag) => tag.id)), [tags]);
	const candidates = useMemo(
		() => (allTags ?? []).filter((tag) => !attachedIds.has(tag.id)),
		[allTags, attachedIds],
	);
	const trimmed = term.trim();
	const exactExists = (allTags ?? []).some(
		(tag) => tag.name.toLowerCase() === trimmed.toLowerCase(),
	);

	const attach = (tagId: string) => {
		addMutation.mutate({ assetIds, tagIds: [tagId] });
		setTerm("");
		setOpen(false);
	};
	const createAndAttach = () => {
		if (!trimmed) return;
		tagByName.mutate({ assetIds, name: trimmed });
		setTerm("");
		setOpen(false);
	};

	return (
		<div className="flex flex-col gap-2">
			<SectionLabel>{T.sidebar.tagsTitle}</SectionLabel>
			<div className="flex flex-wrap items-center gap-1.5">
				{tags.map((tag) => (
					<span
						key={tag.id}
						className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
					>
						<TagDot color={tag.color} />
						<span className="max-w-32 truncate">{tag.name}</span>
						<button
							type="button"
							aria-label={T.tags.removeFromAsset}
							className="text-muted-foreground opacity-60 hover:opacity-100"
							onClick={() =>
								removeMutation.mutate({
									assetIds,
									tagIds: [tag.id],
								})
							}
						>
							<IconClose className="size-3" />
						</button>
					</span>
				))}

				<Popover open={open} onOpenChange={setOpen}>
					{/* No tags yet → full-width dashed "New Tag" row (Eagle-style);
					    otherwise a compact "+" next to the chips. */}
					<PopoverTrigger
						render={
							tags.length > 0 ? (
								<Button
									variant="ghost"
									size="icon"
									className="size-6 text-muted-foreground"
									aria-label={T.tags.newTag}
								/>
							) : (
								<Button
									variant="outline"
									size="sm"
									className="h-8 w-full border-dashed text-muted-foreground text-xs"
								/>
							)
						}
					>
						{tags.length > 0 ? (
							<IconPlus className="size-4" />
						) : (
							<>
								<IconPlus className="size-3.5" />
								{T.tags.newTag}
							</>
						)}
					</PopoverTrigger>
					<PopoverContent className="w-56 p-0" align="start">
						<Command>
							<CommandInput
								placeholder={T.tags.addPlaceholder}
								value={term}
								onValueChange={setTerm}
							/>
							<CommandList>
								<CommandEmpty>
									{trimmed ? (
										<button
											type="button"
											className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent"
											onClick={createAndAttach}
										>
											{T.tags.createEntry(trimmed)}
										</button>
									) : (
										T.tags.noTags
									)}
								</CommandEmpty>
								<CommandGroup>
									{candidates.map((tag) => (
										<CommandItem
											key={tag.id}
											value={tag.name}
											onSelect={() => attach(tag.id)}
										>
											<TagDot color={tag.color} />
											<span className="min-w-0 flex-1 truncate">
												{tag.name}
											</span>
											{tag.asset_count > 0 && (
												<span className="text-muted-foreground text-xs tabular-nums">
													{tag.asset_count}
												</span>
											)}
										</CommandItem>
									))}
									{trimmed && !exactExists && (
										<CommandItem
											value={`__create__${trimmed}`}
											onSelect={createAndAttach}
										>
											<IconPlus className="size-3.5" />
											{T.tags.createEntry(trimmed)}
										</CommandItem>
									)}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}
