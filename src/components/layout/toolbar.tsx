/**
 * Top toolbar: back/forward (router history) | current-location title |
 * zoom slider + debounced search (written to search params with `replace`,
 * so typing never pollutes history).
 */

import { useQuery } from "@tanstack/react-query";
import {
	useCanGoBack,
	useNavigate,
	useRouter,
	useSearch,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	IconChevronLeft,
	IconChevronRight,
	IconMinus,
	IconPlus,
	IconSearch,
} from "@/components/icons";
import { ColorFilter } from "@/components/layout/color-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useWindowDrag } from "@/hooks/use-window-drag";
import { foldersQueryOptions } from "@/lib/queries/folders";
import { tagsQueryOptions } from "@/lib/queries/tags";
import {
	MAX_ROW_HEIGHT,
	MIN_ROW_HEIGHT,
	useViewPrefsStore,
} from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";

export function Toolbar() {
	const router = useRouter();
	const windowDrag = useWindowDrag();
	const canGoBack = useCanGoBack();
	const search = useSearch({ from: "/_library/" });
	const navigate = useNavigate();
	const { data: folders } = useQuery(foldersQueryOptions());
	const { data: tags } = useQuery(tagsQueryOptions());

	const targetRowHeight = useViewPrefsStore((state) => state.targetRowHeight);
	const setTargetRowHeight = useViewPrefsStore(
		(state) => state.setTargetRowHeight,
	);

	// Debounced search → search params (replace, no history noise).
	const [term, setTerm] = useState(search.q ?? "");
	const debouncedTerm = useDebouncedValue(term, 300);
	useEffect(() => {
		// External change (view switch clears q) → resync the input.
		setTerm(search.q ?? "");
	}, [search.q]);
	useEffect(() => {
		const next = debouncedTerm.trim() || undefined;
		if (next === (search.q ?? undefined)) return;
		void navigate({
			to: "/",
			search: { ...search, q: next },
			replace: true,
		});
	}, [debouncedTerm, navigate, search]);

	const title = (() => {
		if (search.q) return T.viewTitles.searchPrefix(search.q);
		switch (search.view) {
			case "folder":
				return (
					folders?.find((folder) => folder.id === search.folderId)?.name ??
					T.viewTitles.folderFallback
				);
			case "tag":
				return (
					tags?.find((tag) => tag.id === search.tagId)?.name ??
					T.viewTitles.tagFallback
				);
			case "color":
				return T.viewTitles.color;
			case "similar":
				return T.viewTitles.similar;
			case "uncategorized":
				return T.viewTitles.uncategorized;
			case "untagged":
				return T.viewTitles.untagged;
			case "recent":
				return T.viewTitles.recent;
			case "trash":
				return T.viewTitles.trash;
			default:
				return T.viewTitles.all;
		}
	})();

	const ZOOM_STEP = 16;
	const stepZoom = (delta: number) =>
		setTargetRowHeight(
			Math.min(
				MAX_ROW_HEIGHT,
				Math.max(MIN_ROW_HEIGHT, targetRowHeight + delta),
			),
		);

	return (
		// The grid route's own header (center column) — Eagle-style anatomy:
		// nav + title | centered zoom group | filters + search. Doubles as a
		// window drag strip; double-click zooms the window (no native titlebar).
		// biome-ignore lint/a11y/noStaticElementInteractions: window-chrome drag/zoom gestures, not content interaction
		<header
			className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b px-3"
			onPointerDown={windowDrag.onPointerDown}
			onDoubleClick={windowDrag.onDoubleClick}
		>
			<div className="flex min-w-0 items-center gap-0.5">
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={T.toolbar.back}
					disabled={!canGoBack}
					onClick={() => router.history.back()}
				>
					<IconChevronLeft className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={T.toolbar.forward}
					// No "can go forward" API — forward on empty history is a no-op.
					onClick={() => router.history.forward()}
				>
					<IconChevronRight className="size-4" />
				</Button>
				<span className="min-w-0 truncate pl-1.5 font-medium text-sm">
					{title}
				</span>
			</div>

			{/* Centered zoom group (Eagle layout): − slider + */}
			<div className="flex items-center gap-1" title={T.toolbar.zoom}>
				<Button
					variant="ghost"
					size="icon"
					className="size-6 text-muted-foreground"
					aria-label={T.toolbar.zoomOut}
					onClick={() => stepZoom(-ZOOM_STEP)}
				>
					<IconMinus className="size-3.5" />
				</Button>
				<Slider
					className="w-36"
					value={targetRowHeight}
					min={MIN_ROW_HEIGHT}
					max={MAX_ROW_HEIGHT}
					step={4}
					onValueChange={(value) => {
						if (typeof value === "number") setTargetRowHeight(value);
					}}
				/>
				<Button
					variant="ghost"
					size="icon"
					className="size-6 text-muted-foreground"
					aria-label={T.toolbar.zoomIn}
					onClick={() => stepZoom(ZOOM_STEP)}
				>
					<IconPlus className="size-3.5" />
				</Button>
			</div>

			<div className="flex items-center justify-end gap-1.5">
				<ColorFilter search={search} />
				<div className="relative">
					<IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground/70" />
					<Input
						className="h-8 w-48 pl-8"
						placeholder={T.toolbar.searchPlaceholder}
						value={term}
						onChange={(event) => setTerm(event.target.value)}
					/>
				</div>
			</div>
		</header>
	);
}
