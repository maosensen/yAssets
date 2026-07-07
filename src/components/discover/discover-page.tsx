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
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { SourceFilters, SourceItem, SourceProvider } from "@/lib/bindings";
import { isCommandError } from "@/lib/errors";
import { useImportSourceItems, useSourceSearch } from "@/lib/queries/sources";
import { useSourcesStore } from "@/lib/stores/sources-store";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

/** Brand names — same across locales. */
const PROVIDERS: Array<{ id: SourceProvider; label: string }> = [
	{ id: "wallhaven", label: "Wallhaven" },
	{ id: "pixabay", label: "Pixabay" },
	{ id: "openverse", label: "Openverse" },
	{ id: "pexels", label: "Pexels" },
	{ id: "iconify", label: "Iconify" },
];

/** Popular Iconify set prefixes — brand names, same across locales. */
const ICON_SETS: Array<{ value: string; label: string }> = [
	{ value: "mdi", label: "Material Design Icons" },
	{ value: "material-symbols", label: "Material Symbols" },
	{ value: "solar", label: "Solar" },
	{ value: "tabler", label: "Tabler" },
	{ value: "lucide", label: "Lucide" },
	{ value: "ph", label: "Phosphor" },
	{ value: "ri", label: "Remix Icon" },
	{ value: "heroicons", label: "Heroicons" },
];

/** UI-side filter fields; each provider reads its own subset. */
type UiFilterKey =
	| "categories"
	| "ratios"
	| "atleast"
	| "imageType"
	| "orientation"
	| "size"
	| "licenseType"
	| "category"
	| "aspectRatio"
	| "prefix"
	| "style"
	| "mediaType";
type UiFilters = Partial<Record<UiFilterKey, string>>;

/** Compact filter dropdown: the unset option shows the filter's name. */
function FilterSelect({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: Array<{ value: string; label: string }>;
	onChange: (value: string) => void;
}) {
	return (
		<NativeSelect
			size="sm"
			aria-label={label}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		>
			<NativeSelectOption value="">{label}</NativeSelectOption>
			{options.map((option) => (
				<NativeSelectOption key={option.value} value={option.value}>
					{option.label}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}

export function DiscoverPage() {
	const wallhavenApiKey = useSourcesStore((state) => state.wallhavenApiKey);
	const pixabayApiKey = useSourcesStore((state) => state.pixabayApiKey);
	const pexelsApiKey = useSourcesStore((state) => state.pexelsApiKey);
	const { theme } = useTheme();

	// Iconify monochrome icons use currentColor, which renders black in an <img>.
	// Color the thumbnails with a neutral that reads on the active theme (the
	// imported original SVG keeps currentColor, so it stays recolorable).
	const resolvedDark =
		theme === "dark" ||
		(theme === "system" &&
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches);
	const iconColor = resolvedDark ? "#c9ccd1" : "#3f4247";

	const [provider, setProvider] = useState<SourceProvider>("wallhaven");
	const [query, setQuery] = useState("");
	const [wallhavenSort, setWallhavenSort] = useState("date_added");
	const [pixabaySort, setPixabaySort] = useState("popular");
	const [includeNsfw, setIncludeNsfw] = useState(false);
	// Per-provider filter selections — remembered across provider switches.
	const [uiFilters, setUiFilters] = useState<Record<SourceProvider, UiFilters>>(
		() => ({
			wallhaven: {},
			pixabay: {},
			openverse: {},
			pexels: {},
			iconify: {},
		}),
	);
	const currentFilters = uiFilters[provider];
	const setFilter = (key: UiFilterKey, value: string) =>
		setUiFilters((prev) => {
			const next: UiFilters = {
				...prev[provider],
				[key]: value || undefined,
			};
			// Image and audio categories are different vocabularies, and aspect
			// is image-only — a stale value would 400 on the other endpoint.
			if (key === "mediaType") {
				next.category = undefined;
				next.aspectRatio = undefined;
			}
			return { ...prev, [provider]: next };
		});
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	const debouncedQuery = useDebouncedValue(query, 400);

	// Per-provider API key (Wallhaven + Openverse are keyless).
	const apiKey =
		provider === "wallhaven"
			? wallhavenApiKey
			: provider === "pixabay"
				? pixabayApiKey
				: provider === "pexels"
					? pexelsApiKey
					: "";
	const hasKey = apiKey.trim().length > 0;
	// Only Wallhaven and Pixabay expose sorting; Openverse/Pexels search is
	// relevance-only.
	const sorting =
		provider === "wallhaven"
			? wallhavenSort
			: provider === "pixabay"
				? pixabaySort
				: null;
	// Pixabay and Pexels have no keyless mode; Wallhaven/Openverse browse without.
	const needsKey = (provider === "pixabay" || provider === "pexels") && !hasKey;

	const filters: SourceFilters = useMemo(
		() => ({
			categories:
				provider === "wallhaven" ? (currentFilters.categories ?? null) : null,
			// Purity is a Wallhaven concept; other providers are SFW by default.
			purity:
				provider === "wallhaven"
					? hasKey && includeNsfw
						? "111"
						: "100"
					: null,
			sorting,
			order: null,
			atleast:
				provider === "wallhaven" ? (currentFilters.atleast ?? null) : null,
			ratios: provider === "wallhaven" ? (currentFilters.ratios ?? null) : null,
			image_type:
				provider === "pixabay" ? (currentFilters.imageType ?? null) : null,
			orientation:
				provider === "pixabay" || provider === "pexels"
					? (currentFilters.orientation ?? null)
					: null,
			size: provider === "pexels" ? (currentFilters.size ?? null) : null,
			license_type:
				provider === "openverse" ? (currentFilters.licenseType ?? null) : null,
			category:
				provider === "openverse" ? (currentFilters.category ?? null) : null,
			aspect_ratio:
				provider === "openverse" ? (currentFilters.aspectRatio ?? null) : null,
			prefix: provider === "iconify" ? (currentFilters.prefix ?? null) : null,
			palette:
				provider === "iconify"
					? currentFilters.style === "color"
						? true
						: currentFilters.style === "mono"
							? false
							: null
					: null,
			media_type:
				provider === "openverse" ? (currentFilters.mediaType ?? null) : null,
		}),
		[provider, hasKey, includeNsfw, sorting, currentFilters],
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
			: provider === "pixabay"
				? [
						{ value: "popular", label: T.discover.sortPopular },
						{ value: "latest", label: T.discover.sortLatest },
					]
				: [];
	const setSort = provider === "wallhaven" ? setWallhavenSort : setPixabaySort;

	// Per-provider filter dropdowns — built in render so labels track the locale.
	const providerSelects: Array<{
		key: UiFilterKey;
		label: string;
		options: Array<{ value: string; label: string }>;
	}> =
		provider === "wallhaven"
			? [
					{
						key: "categories",
						label: T.discover.filterCategory,
						options: [
							{ value: "100", label: T.discover.catGeneral },
							{ value: "010", label: T.discover.catAnime },
							{ value: "001", label: T.discover.catPeople },
						],
					},
					{
						key: "ratios",
						label: T.discover.filterAspect,
						options: [
							{ value: "landscape", label: T.discover.aspectLandscape },
							{ value: "portrait", label: T.discover.aspectPortrait },
							{ value: "1x1", label: T.discover.aspectSquare },
						],
					},
					{
						key: "atleast",
						label: T.discover.filterMinRes,
						options: [
							{ value: "1920x1080", label: "≥ 1080p" },
							{ value: "2560x1440", label: "≥ 1440p" },
							{ value: "3840x2160", label: "≥ 4K" },
						],
					},
				]
			: provider === "pixabay"
				? [
						{
							key: "imageType",
							label: T.discover.filterType,
							options: [
								{ value: "photo", label: T.discover.typePhoto },
								{ value: "illustration", label: T.discover.typeIllustration },
								{ value: "vector", label: T.discover.typeVector },
							],
						},
						{
							key: "orientation",
							label: T.discover.filterAspect,
							options: [
								{ value: "horizontal", label: T.discover.aspectLandscape },
								{ value: "vertical", label: T.discover.aspectPortrait },
							],
						},
					]
				: provider === "openverse"
					? [
							{
								key: "mediaType" as const,
								label: T.discover.filterMedia,
								options: [
									// The backend only branches on "audio"; "images" is an
									// explicit way to come back to the default.
									{ value: "images", label: T.discover.mediaImages },
									{ value: "audio", label: T.discover.mediaAudio },
								],
							},
							{
								key: "licenseType" as const,
								label: T.discover.filterLicense,
								options: [
									{ value: "commercial", label: T.discover.licenseCommercial },
									{
										value: "modification",
										label: T.discover.licenseModification,
									},
								],
							},
							// Category values differ per media kind; aspect is image-only.
							...(currentFilters.mediaType === "audio"
								? [
										{
											key: "category" as const,
											label: T.discover.filterType,
											options: [
												{ value: "music", label: T.discover.catMusic },
												{
													value: "sound_effect",
													label: T.discover.catSoundEffect,
												},
												{ value: "podcast", label: T.discover.catPodcast },
												{
													value: "audiobook",
													label: T.discover.catAudiobook,
												},
											],
										},
									]
								: [
										{
											key: "category" as const,
											label: T.discover.filterType,
											options: [
												{ value: "photograph", label: T.discover.typePhoto },
												{
													value: "illustration",
													label: T.discover.typeIllustration,
												},
												{
													value: "digitized_artwork",
													label: T.discover.typeArtwork,
												},
											],
										},
										{
											key: "aspectRatio" as const,
											label: T.discover.filterAspect,
											options: [
												{ value: "wide", label: T.discover.aspectLandscape },
												{ value: "tall", label: T.discover.aspectPortrait },
												{ value: "square", label: T.discover.aspectSquare },
											],
										},
									]),
						]
					: provider === "pexels"
						? [
								{
									key: "orientation",
									label: T.discover.filterAspect,
									options: [
										{ value: "landscape", label: T.discover.aspectLandscape },
										{ value: "portrait", label: T.discover.aspectPortrait },
										{ value: "square", label: T.discover.aspectSquare },
									],
								},
								{
									key: "size",
									label: T.discover.filterSize,
									options: [
										{ value: "large", label: T.discover.sizeLarge },
										{ value: "medium", label: T.discover.sizeMedium },
										{ value: "small", label: T.discover.sizeSmall },
									],
								},
							]
						: [
								{
									key: "prefix",
									label: T.discover.filterIconSet,
									options: ICON_SETS,
								},
								{
									key: "style",
									label: T.discover.filterStyle,
									options: [
										{ value: "mono", label: T.discover.styleMono },
										{ value: "color", label: T.discover.styleColor },
									],
								},
							];

	return (
		<div className="flex h-full flex-col">
			<header className="border-b">
				{/* Tier 1 — source menu (+ batch actions when a selection exists). */}
				<div className="flex flex-wrap items-center gap-1 px-3 pt-2">
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
				</div>

				{/* Tier 2 — search + this source's own filters. */}
				<div className="flex flex-wrap items-center gap-2 px-3 py-2">
					<div className="relative min-w-40 flex-1">
						<IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground/70" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={
								provider === "iconify"
									? T.discover.searchIconsPlaceholder
									: T.discover.searchPlaceholder
							}
							className="pl-8"
						/>
					</div>

					{providerSelects.map((select) => (
						<FilterSelect
							key={`${provider}-${select.key}`}
							label={select.label}
							value={currentFilters[select.key] ?? ""}
							options={select.options}
							onChange={(value) => setFilter(select.key, value)}
						/>
					))}

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
				</div>
			</header>

			{needsKey ? (
				<EmptyState
					icon={IconDiscover}
					title={T.discover.needsKeyTitle}
					hint={
						provider === "pexels"
							? T.discover.pexelsNeedsKeyHint
							: T.discover.needsKeyHint
					}
				/>
			) : search.isError && search.items.length === 0 ? (
				// Full-screen error states only when there is nothing to show — a
				// failed next-page fetch (e.g. a 429 mid-scroll) must not blank out
				// the results already on screen.
				isCommandError(search.error) && search.error.code === "RateLimited" ? (
					<EmptyState
						icon={IconWarning}
						title={T.discover.rateLimitedTitle}
						hint={T.discover.rateLimitedHint}
					/>
				) : (
					<EmptyState
						icon={IconWarning}
						tone="destructive"
						title={T.discover.errorTitle}
						hint={T.discover.errorHint}
					/>
				)
			) : search.items.length === 0 && !search.isLoading ? (
				provider === "iconify" && debouncedQuery.trim() === "" ? (
					<EmptyState
						icon={IconSearch}
						title={T.discover.iconifyEmptyTitle}
						hint={T.discover.iconifyEmptyHint}
					/>
				) : (
					<EmptyState
						icon={IconDiscover}
						title={T.discover.emptyTitle}
						hint={T.discover.emptyHint}
					/>
				)
			) : (
				<RemoteGrid
					items={search.items}
					selectedIds={selectedIds}
					onToggleSelect={toggleSelect}
					onAddOne={addOne}
					iconColor={iconColor}
					hasNextPage={search.hasNextPage}
					isFetchingNextPage={search.isFetchingNextPage}
					onLoadMore={search.fetchNextPage}
				/>
			)}
		</div>
	);
}
