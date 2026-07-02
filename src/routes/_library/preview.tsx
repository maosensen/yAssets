/**
 * Full-pane image preview — a route, not an overlay. Renders in the shell's
 * middle pane (sidebar + inspector stay put), with its own topbar carrying
 * back / filename / counter / prev-next and room for future actions
 * (zoom, rotate, edit…). Navigated to from a grid double-click.
 *
 * View context (view/folderId/q) rides in search params so the same cached
 * list backs prev/next; `id` is the current asset.
 */

import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { libraryViewSchema, scopeFromView } from "@/lib/library-view";
import { fileUrl, thumbUrl } from "@/lib/media";
import { assetListQueryOptions } from "@/lib/queries/assets";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";

const previewSearchSchema = libraryViewSchema.extend({
	id: z.string(),
});

export const Route = createFileRoute("/_library/preview")({
	validateSearch: previewSearchSchema,
	component: PreviewPage,
});

function PreviewPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const router = useRouter();
	const sort = useViewPrefsStore((state) => state.sort);
	const dir = useViewPrefsStore((state) => state.dir);
	const selectOnly = useSelectionStore((state) => state.selectOnly);

	const view = useMemo(
		() => ({ view: search.view, folderId: search.folderId, q: search.q }),
		[search.view, search.folderId, search.q],
	);
	const { data } = useQuery(
		assetListQueryOptions({
			scope: scopeFromView(view),
			search: view.q,
			sort,
			dir,
		}),
	);

	const items = data?.items ?? [];
	const index = items.findIndex((asset) => asset.id === search.id);
	const asset = index >= 0 ? items[index] : undefined;

	const goBack = () => {
		if (router.history.canGoBack()) router.history.back();
		else void navigate({ to: "/", search: view, replace: true });
	};
	const goTo = (nextIndex: number) => {
		const next = items[nextIndex];
		if (next) {
			void navigate({
				to: "/preview",
				search: { ...view, id: next.id },
				replace: true,
			});
		}
	};

	// Selection follows the previewed asset, so the inspector shows it.
	useEffect(() => {
		if (asset) selectOnly(asset.id);
	}, [asset, selectOnly]);

	// Keyboard: Esc back, ←/→ navigate. Latest closures via ref so the
	// listener mounts once (stable deps) yet always sees current index.
	const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
	keyHandler.current = (event: KeyboardEvent) => {
		if (event.key === "Escape") goBack();
		else if (event.key === "ArrowLeft" && index > 0) goTo(index - 1);
		else if (event.key === "ArrowRight" && index < items.length - 1) {
			goTo(index + 1);
		}
	};
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => keyHandler.current(event);
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	// Data shrank out from under us (deleted / view changed) → back to grid.
	useEffect(() => {
		if (data && index < 0) {
			void navigate({ to: "/", search: view, replace: true });
		}
	}, [data, index, navigate, view]);

	return (
		<div className="flex h-full flex-col bg-background">
			<PreviewTopbar
				title={asset?.name ?? ""}
				index={index}
				total={items.length}
				onBack={goBack}
				onPrev={() => goTo(index - 1)}
				onNext={() => goTo(index + 1)}
			/>
			<div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
				{asset ? (
					<PreviewImage key={asset.id} asset={asset} />
				) : (
					<span className="text-muted-foreground text-sm">
						{T.common.loading}
					</span>
				)}
			</div>
		</div>
	);
}

function PreviewTopbar({
	title,
	index,
	total,
	onBack,
	onPrev,
	onNext,
}: {
	title: string;
	index: number;
	total: number;
	onBack: () => void;
	onPrev: () => void;
	onNext: () => void;
}) {
	return (
		<header
			className="flex h-12 shrink-0 items-center gap-2 border-b px-3"
			data-tauri-drag-region
		>
			<Button
				variant="ghost"
				size="icon"
				aria-label={T.preview.close}
				onClick={onBack}
			>
				<X className="size-4" />
			</Button>
			<span className="min-w-0 flex-1 truncate font-medium text-sm">
				{title}
			</span>
			{/* Room reserved here for future actions (zoom / rotate / edit). */}
			<span className="text-muted-foreground text-xs tabular-nums">
				{total > 0 ? T.preview.counter(index + 1, total) : ""}
			</span>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					aria-label={T.preview.prev}
					disabled={index <= 0}
					onClick={onPrev}
				>
					<ChevronLeft className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label={T.preview.next}
					disabled={index < 0 || index >= total - 1}
					onClick={onNext}
				>
					<ChevronRight className="size-4" />
				</Button>
			</div>
		</header>
	);
}

/** Thumbnail bridges instantly; the original swaps in once decoded. */
function PreviewImage({
	asset,
}: {
	asset: { id: string; name: string; ext: string; has_thumb: boolean };
}) {
	const [originalSrc, setOriginalSrc] = useState<string | null>(null);

	useEffect(() => {
		if (!asset.has_thumb) return;
		const image = new Image();
		image.onload = () => setOriginalSrc(image.src);
		image.src = fileUrl(asset.id);
		return () => {
			image.onload = null;
		};
	}, [asset.id, asset.has_thumb]);

	if (!asset.has_thumb) {
		return (
			<span className="rounded-lg bg-muted px-6 py-4 font-medium text-2xl text-muted-foreground uppercase">
				{asset.ext || "?"}
			</span>
		);
	}
	return (
		<img
			src={originalSrc ?? thumbUrl(asset.id)}
			alt={asset.name}
			className="max-h-full max-w-full object-contain"
			draggable={false}
		/>
	);
}
