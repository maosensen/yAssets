/**
 * Discover — browse third-party image sources and import favorites. Pick a
 * provider (Wallhaven / Pixabay), search + sort, then click to multi-select,
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
import type { SourceFilters, SourceItem, SourceProvider } from "@/lib/bindings";
import { useImportSourceItems, useSourceSearch } from "@/lib/queries/sources";
import { useSourcesStore } from "@/lib/stores/sources-store";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

/** Brand names — same across locales. */
const PROVIDERS: Array<{ id: SourceProvider; label: string }> = [
	{ id: "wallhaven", label: "Wallhaven" },
	{ id: "pixabay", label: "Pixabay" },
];

export function DiscoverPage() {
	const wallhavenApiKey = useSourcesStore((state) => state.wallhavenApiKey);
	const pixabayApiKey = useSourcesStore((state) => state.pixabayApiKey);

	const [provider, setProvider] = useState<SourceProvider>("wallhaven");
	const [query, setQuery] = useState("");
	const [wallhavenSort, setWallhavenSort] = useState("date_added");
	const [pixabaySort, setPixabaySort] = useState("popular");
	const [includeNsfw, setIncludeNsfw] = useState(false);
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	const debouncedQuery = useDebouncedValue(query, 400);

	const apiKey = provider === "wallhaven" ? wallhavenApiKey : pixabayApiKey;
	const hasKey = apiKey.trim().length > 0;
	const sorting = provider === "wallhaven" ? wallhavenSort : pixabaySort;
	// Pixabay has no keyless mode; Wallhaven browses SFW without one.
	const needsKey = provider === "pixabay" && !hasKey;

	const filters: SourceFilters = useMemo(
		() => ({
			categories: null,
			purity: provider === "wallhaven" && hasKey && includeNsfw ? "111" : "100",
			sorting,
			order: null,
		}),
		[provider, hasKey, includeNsfw, sorting],
	);

	const search = useSourceSearch(
		provider,
		debouncedQuery,
		filters,
		hasKey ? apiKey.trim() : null,
		!needsKey,
	);
	const importItems = useImportSourceItems();

	// A provider/search/filter change invalidates the old selection.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on result-set change, not on every items ref.
	useEffect(() => {
		setSelectedIds(new Set());
	}, [provider, debouncedQuery, filters]);

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

	const sortOptions =
		provider === "wallhaven"
			? [
					{ value: "date_added", label: T.discover.sortLatest },
					{ value: "toplist", label: T.discover.sortTop },
					{ value: "views", label: T.discover.sortViews },
					{ value: "random", label: T.discover.sortRandom },
				]
			: [
					{ value: "popular", label: T.discover.sortPopular },
					{ value: "latest", label: T.discover.sortLatest },
				];
	const setSort = provider === "wallhaven" ? setWallhavenSort : setPixabaySort;

	return (
		<div className="flex h-full flex-col">
			<header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
				<div className="flex items-center gap-1">
					{PROVIDERS.map((option) => (
						<Button
							key={option.id}
							type="button"
							variant="ghost"
							size="sm"
							aria-pressed={provider === option.id}
							className={cn(
								"h-8",
								provider === option.id
									? "bg-accent text-accent-foreground"
									: "text-muted-foreground",
							)}
							onClick={() => setProvider(option.id)}
						>
							{option.label}
						</Button>
					))}
				</div>

				<div className="relative min-w-40 flex-1">
					<IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground/70" />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={T.discover.searchPlaceholder}
						className="pl-8"
					/>
				</div>

				<div className="flex items-center gap-1">
					{sortOptions.map((option) => (
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
							onClick={() => setSort(option.value)}
						>
							{option.label}
						</Button>
					))}
				</div>

				{provider === "wallhaven" && hasKey && (
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

			{needsKey ? (
				<EmptyState
					icon={IconDiscover}
					title={T.discover.needsKeyTitle}
					hint={T.discover.needsKeyHint}
				/>
			) : search.isError ? (
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
