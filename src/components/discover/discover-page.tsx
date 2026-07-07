/**
 * Discover — browse third-party image sources (Wallhaven) and import favorites.
 * Search + sort + infinite grid of remote thumbnails; click to multi-select,
 * hover to add one, or "Add N" for the batch. All network + downloads happen in
 * Rust; imported assets carry the source page as provenance.
 */

import { useEffect, useMemo, useState } from "react";
import { RemoteGrid } from "@/components/discover/remote-grid";
import { EmptyState } from "@/components/empty-state";
import { IconDiscover, IconSearch, IconWarning } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { SourceFilters, SourceItem } from "@/lib/bindings";
import { useImportSourceItems, useSourceSearch } from "@/lib/queries/sources";
import { useSourcesStore } from "@/lib/stores/sources-store";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

export function DiscoverPage() {
	const apiKey = useSourcesStore((state) => state.wallhavenApiKey);
	const [query, setQuery] = useState("");
	const [sorting, setSorting] = useState("date_added");
	const [includeNsfw, setIncludeNsfw] = useState(false);
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	const debouncedQuery = useDebouncedValue(query, 400);
	const hasKey = apiKey.trim().length > 0;

	const filters: SourceFilters = useMemo(
		() => ({
			categories: null,
			purity: hasKey && includeNsfw ? "111" : "100",
			sorting,
			order: null,
		}),
		[sorting, includeNsfw, hasKey],
	);

	const search = useSourceSearch(
		debouncedQuery,
		filters,
		hasKey ? apiKey.trim() : null,
	);
	const importItems = useImportSourceItems();

	// A new search/filter set invalidates the old selection (its ids may no
	// longer be on screen).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the result set changes, not on every items ref.
	useEffect(() => {
		setSelectedIds(new Set());
	}, [debouncedQuery, filters]);

	const toggleSelect = (id: string) =>
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const addOne = (item: SourceItem) =>
		importItems.mutate({ items: [item], folderId: null });

	const addSelected = () => {
		const chosen = search.items.filter((item) => selectedIds.has(item.id));
		if (chosen.length === 0) return;
		importItems.mutate({ items: chosen, folderId: null });
		setSelectedIds(new Set());
	};

	const sorts = [
		{ value: "date_added", label: T.discover.sortLatest },
		{ value: "toplist", label: T.discover.sortTop },
		{ value: "views", label: T.discover.sortViews },
		{ value: "random", label: T.discover.sortRandom },
	];

	return (
		<div className="flex h-full flex-col">
			<header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
				<div className="relative min-w-48 flex-1">
					<IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground/70" />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={T.discover.searchPlaceholder}
						className="pl-8"
					/>
				</div>

				<div className="flex items-center gap-1">
					{sorts.map((option) => (
						<Button
							key={option.value}
							type="button"
							variant="ghost"
							size="sm"
							aria-pressed={sorting === option.value}
							className={cn(
								"h-8",
								sorting === option.value
									? "bg-accent text-accent-foreground"
									: "text-muted-foreground",
							)}
							onClick={() => setSorting(option.value)}
						>
							{option.label}
						</Button>
					))}
				</div>

				{hasKey && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-pressed={includeNsfw}
						className={cn(
							"h-8",
							includeNsfw
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground",
						)}
						onClick={() => setIncludeNsfw((value) => !value)}
					>
						{T.discover.nsfw}
					</Button>
				)}

				{selectedIds.size > 0 && (
					<div className="ml-auto flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							className="h-8"
							disabled={importItems.isPending}
							onClick={addSelected}
						>
							{T.discover.addSelected(selectedIds.size)}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8"
							onClick={() => setSelectedIds(new Set())}
						>
							{T.discover.clearSelection}
						</Button>
					</div>
				)}
			</header>

			{search.isError ? (
				<EmptyState
					icon={IconWarning}
					tone="destructive"
					title={T.discover.errorTitle}
					hint={T.discover.errorHint}
				/>
			) : search.items.length === 0 && !search.isLoading ? (
				<EmptyState
					icon={IconDiscover}
					title={T.discover.emptyTitle}
					hint={T.discover.emptyHint}
				/>
			) : (
				<RemoteGrid
					items={search.items}
					selectedIds={selectedIds}
					onToggleSelect={toggleSelect}
					onAddOne={addOne}
					hasNextPage={search.hasNextPage}
					isFetchingNextPage={search.isFetchingNextPage}
					onLoadMore={search.fetchNextPage}
				/>
			)}
		</div>
	);
}
