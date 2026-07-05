/**
 * Filter control — a toolbar popover with ad-hoc facets (minimum rating, file
 * type, tags) that stack ON TOP of the current view/scope. Writes them to the
 * URL search params (shareable + back/forward); the query layer threads them
 * into the list query and cache key. Color has its own control (ColorFilter).
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { IconFilter } from "@/components/icons";
import { RatingStars } from "@/components/inspector/rating-stars";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { FILE_KINDS } from "@/lib/file-kinds";
import type { LibraryView } from "@/lib/library-view";
import { tagsQueryOptions } from "@/lib/queries/tags";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

export function FilterControl({ search }: { search: LibraryView }) {
	const navigate = useNavigate();
	const { data: tags } = useQuery(tagsQueryOptions());

	const kinds = search.types ?? [];
	const tagIds = search.tags ?? [];
	const rating = search.rating ?? 0;
	const active = rating > 0 || kinds.length > 0 || tagIds.length > 0;

	const patch = (next: Partial<LibraryView>) =>
		void navigate({ to: "/", search: { ...search, ...next }, replace: true });

	const toggle = (list: string[], value: string) =>
		list.includes(value)
			? list.filter((item) => item !== value)
			: [...list, value];

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						className="relative size-8"
						title={T.filter.label}
						aria-label={T.filter.label}
					/>
				}
			>
				<IconFilter className={cn("size-4", active && "text-primary")} />
				{active && (
					<span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
				)}
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 p-3">
				<div className="flex flex-col gap-3">
					<section className="flex flex-col gap-1.5">
						<Label>{T.filter.rating}</Label>
						<RatingStars
							value={rating}
							onChange={(next) =>
								patch({ rating: next > 0 ? next : undefined })
							}
						/>
					</section>

					<section className="flex flex-col gap-1.5">
						<Label>{T.filter.fileType}</Label>
						<div className="flex flex-wrap gap-1.5">
							{FILE_KINDS.map((kind) => {
								const on = kinds.includes(kind.key);
								return (
									<button
										key={kind.key}
										type="button"
										onClick={() => {
											const next = toggle(kinds, kind.key);
											patch({ types: next.length ? next : undefined });
										}}
										className={cn(
											"rounded-md border px-2 py-0.5 text-xs transition-colors",
											on
												? "border-primary bg-primary/10 text-foreground"
												: "text-muted-foreground hover:bg-accent",
										)}
									>
										{kind.label}
									</button>
								);
							})}
						</div>
					</section>

					<section className="flex flex-col gap-1.5">
						<Label>{T.filter.tags}</Label>
						{(tags ?? []).length === 0 ? (
							<span className="text-muted-foreground text-xs">
								{T.filter.noTags}
							</span>
						) : (
							<div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
								{(tags ?? []).map((tag) => {
									const on = tagIds.includes(tag.id);
									return (
										<button
											key={tag.id}
											type="button"
											onClick={() => {
												const next = toggle(tagIds, tag.id);
												patch({ tags: next.length ? next : undefined });
											}}
											className={cn(
												"flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent",
												on && "text-foreground",
											)}
										>
											<span
												className={cn(
													"size-3 shrink-0 rounded-full border",
													on && "border-primary bg-primary",
												)}
												style={
													!on && tag.color
														? { backgroundColor: tag.color }
														: undefined
												}
											/>
											<span className="min-w-0 flex-1 truncate">
												{tag.name}
											</span>
										</button>
									);
								})}
							</div>
						)}
					</section>

					{active && (
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-xs"
							onClick={() =>
								patch({ rating: undefined, types: undefined, tags: undefined })
							}
						>
							{T.filter.clear}
						</Button>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function Label({ children }: { children: React.ReactNode }) {
	return (
		<span className="font-medium text-muted-foreground text-xs">
			{children}
		</span>
	);
}
