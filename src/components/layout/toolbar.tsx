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
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { foldersQueryOptions } from "@/lib/queries/folders";
import {
	MAX_ROW_HEIGHT,
	MIN_ROW_HEIGHT,
	useViewPrefsStore,
} from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";

export function Toolbar() {
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const search = useSearch({ from: "/_library/" });
	const navigate = useNavigate();
	const { data: folders } = useQuery(foldersQueryOptions());

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
			case "uncategorized":
				return T.viewTitles.uncategorized;
			case "recent":
				return T.viewTitles.recent;
			case "trash":
				return T.viewTitles.trash;
			default:
				return T.viewTitles.all;
		}
	})();

	return (
		// The grid route's own header (center column) — Eagle-style anatomy.
		// Doubles as a window drag strip (no native titlebar).
		<header
			className="flex h-12 shrink-0 items-center gap-3 border-b px-3"
			data-tauri-drag-region
		>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					aria-label={T.toolbar.back}
					disabled={!canGoBack}
					onClick={() => router.history.back()}
				>
					<ChevronLeft className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label={T.toolbar.forward}
					// No "can go forward" API — forward on empty history is a no-op.
					onClick={() => router.history.forward()}
				>
					<ChevronRight className="size-4" />
				</Button>
			</div>

			<div className="min-w-0 flex-1 truncate font-medium text-sm">{title}</div>

			<div className="flex w-32 items-center" title={T.toolbar.zoom}>
				<Slider
					value={targetRowHeight}
					min={MIN_ROW_HEIGHT}
					max={MAX_ROW_HEIGHT}
					step={4}
					onValueChange={(value) => {
						if (typeof value === "number") setTargetRowHeight(value);
					}}
				/>
			</div>
			<Input
				className="w-52"
				placeholder={T.toolbar.searchPlaceholder}
				value={term}
				onChange={(event) => setTerm(event.target.value)}
			/>
		</header>
	);
}
