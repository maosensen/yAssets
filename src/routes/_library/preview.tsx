/**
 * Full-pane image preview — a route, not an overlay. Renders in the shell's
 * middle pane (sidebar + inspector stay put), with its own topbar carrying
 * back / position / filename, centered zoom controls, and prev-next.
 *
 * Images render in a free pan/zoom canvas (see CanvasViewer): pinch or ⌘±
 * zooms, drag/scroll pans, double-click toggles fit ↔ 100%, `0`/`1` jump to
 * fit/actual. View context (view/folderId/q) rides in search params so the
 * same cached list backs prev/next; `id` is the current asset.
 */

import {
	createFileRoute,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
	IconChevronLeft,
	IconChevronRight,
	IconMinus,
	IconPlus,
} from "@/components/icons";
import { AudioViewer } from "@/components/preview/audio-viewer";
import {
	CanvasViewer,
	type ViewerHandle,
} from "@/components/preview/canvas-viewer";
import { HtmlViewer } from "@/components/preview/html-viewer";
import { PdfViewer } from "@/components/preview/pdf-viewer";
import { TextViewer } from "@/components/preview/text-viewer";
import { VideoViewer } from "@/components/preview/video-viewer";
import { Button } from "@/components/ui/button";
import { useWindowDrag } from "@/hooks/use-window-drag";
import type { AssetSummary } from "@/lib/bindings";
import { libraryViewSchema } from "@/lib/library-view";
import { fileUrl, thumbUrl } from "@/lib/media";
import { useLibraryAssetList } from "@/lib/queries/assets";
import { useSelectionStore } from "@/lib/stores/selection-store";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";
import { viewerKindFor } from "@/lib/viewer-registry";

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

	// Carry EVERY scope field — prev/next must walk the same cached list the
	// grid showed (folder/tag/color/similar views included).
	const view = useMemo(
		() => ({
			view: search.view,
			folderId: search.folderId,
			tagId: search.tagId,
			hue: search.hue,
			similarTo: search.similarTo,
			q: search.q,
		}),
		[
			search.view,
			search.folderId,
			search.tagId,
			search.hue,
			search.similarTo,
			search.q,
		],
	);
	const { data } = useLibraryAssetList(view, sort, dir);

	const items = data?.items ?? [];
	const index = items.findIndex((asset) => asset.id === search.id);
	const asset = index >= 0 ? items[index] : undefined;

	// Zoom state surfaced from the canvas for the topbar controls.
	const viewerRef = useRef<ViewerHandle | null>(null);
	const [zoomPercent, setZoomPercent] = useState<number | null>(null);
	const onScaleChange = useCallback(
		(scale: number) => setZoomPercent(Math.round(scale * 100)),
		[],
	);
	const zoomable = asset !== undefined && viewerKindFor(asset) === "image";
	useEffect(() => {
		if (!zoomable) setZoomPercent(null);
	}, [zoomable]);

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

	// Keyboard: Esc back, ←/→ navigate, ±/0/1 zoom. Latest closures via ref so
	// the listener mounts once (stable deps) yet always sees current index.
	const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
	keyHandler.current = (event: KeyboardEvent) => {
		if (event.key === "Escape") goBack();
		else if (event.key === "ArrowLeft" && index > 0) goTo(index - 1);
		else if (event.key === "ArrowRight" && index < items.length - 1) {
			goTo(index + 1);
		} else if (event.key === "+" || event.key === "=") {
			viewerRef.current?.zoomIn();
		} else if (event.key === "-") {
			viewerRef.current?.zoomOut();
		} else if (event.key === "0") {
			viewerRef.current?.zoomToFit();
		} else if (event.key === "1") {
			viewerRef.current?.zoomToActual();
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
				zoomPercent={zoomPercent}
				viewerRef={viewerRef}
				onBack={goBack}
				onPrev={() => goTo(index - 1)}
				onNext={() => goTo(index + 1)}
			/>
			<div className="min-h-0 flex-1 overflow-hidden">
				{asset ? (
					<PreviewBody
						key={asset.id}
						asset={asset}
						viewerRef={viewerRef}
						onScaleChange={onScaleChange}
					/>
				) : (
					<div className="flex h-full items-center justify-center">
						<span className="text-muted-foreground text-sm">
							{T.common.loading}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

function PreviewTopbar({
	title,
	index,
	total,
	zoomPercent,
	viewerRef,
	onBack,
	onPrev,
	onNext,
}: {
	title: string;
	index: number;
	total: number;
	zoomPercent: number | null;
	viewerRef: React.RefObject<ViewerHandle | null>;
	onBack: () => void;
	onPrev: () => void;
	onNext: () => void;
}) {
	const windowDrag = useWindowDrag();
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: window-chrome drag/zoom gestures, not content interaction
		<header
			className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b px-3"
			onPointerDown={windowDrag.onPointerDown}
			onDoubleClick={windowDrag.onDoubleClick}
		>
			{/* Eagle layout: back + position + filename on the left. */}
			<div className="flex min-w-0 items-center gap-2">
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={T.preview.close}
					onClick={onBack}
				>
					<IconChevronLeft className="size-4" />
				</Button>
				<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
					{total > 0 ? T.preview.counter(index + 1, total) : ""}
				</span>
				<span className="min-w-0 truncate font-medium text-sm" title={title}>
					{title}
				</span>
			</div>

			{/* Centered zoom group — only for zoomable (image) assets. */}
			<div className="flex items-center gap-1">
				{zoomPercent !== null && (
					<>
						<Button
							variant="ghost"
							size="icon"
							className="size-6 text-muted-foreground"
							aria-label={T.preview.zoomOut}
							onClick={() => viewerRef.current?.zoomOut()}
						>
							<IconMinus className="size-3.5" />
						</Button>
						<button
							type="button"
							className="min-w-12 text-center text-muted-foreground text-xs tabular-nums transition-colors hover:text-foreground"
							title={T.preview.zoomFit}
							onClick={() => viewerRef.current?.zoomToFit()}
						>
							{zoomPercent}%
						</button>
						<Button
							variant="ghost"
							size="icon"
							className="size-6 text-muted-foreground"
							aria-label={T.preview.zoomIn}
							onClick={() => viewerRef.current?.zoomIn()}
						>
							<IconPlus className="size-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-1.5 text-[11px] text-muted-foreground"
							title={T.preview.zoomActual}
							onClick={() => viewerRef.current?.zoomToActual()}
						>
							1:1
						</Button>
					</>
				)}
			</div>

			<div className="flex items-center justify-end gap-0.5">
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={T.preview.prev}
					disabled={index <= 0}
					onClick={onPrev}
				>
					<IconChevronLeft className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={T.preview.next}
					disabled={index < 0 || index >= total - 1}
					onClick={onNext}
				>
					<IconChevronRight className="size-4" />
				</Button>
			</div>
		</header>
	);
}

/**
 * Viewer dispatch (see lib/viewer-registry): images get the pan/zoom canvas,
 * audio gets native controls, markdown/text render inline; everything else
 * keeps the extension placeholder.
 */
function PreviewBody({
	asset,
	viewerRef,
	onScaleChange,
}: {
	asset: AssetSummary;
	viewerRef: React.RefObject<ViewerHandle | null>;
	onScaleChange: (scale: number) => void;
}) {
	const kind = viewerKindFor(asset);
	switch (kind) {
		case "image":
			return (
				<ImageBody
					asset={asset}
					viewerRef={viewerRef}
					onScaleChange={onScaleChange}
				/>
			);
		case "video":
			return (
				<VideoViewer
					assetId={asset.id}
					name={asset.name}
					hasThumb={asset.has_thumb}
				/>
			);
		case "audio":
			return <AudioViewer assetId={asset.id} name={asset.name} />;
		case "pdf":
			return <PdfViewer assetId={asset.id} name={asset.name} />;
		case "html":
			return <HtmlViewer assetId={asset.id} name={asset.name} />;
		case "markdown":
		case "text":
			return <TextViewer assetId={asset.id} markdown={kind === "markdown"} />;
		default:
			return (
				<div className="flex h-full items-center justify-center">
					<span className="rounded-md bg-muted px-6 py-4 font-medium text-2xl text-muted-foreground uppercase">
						{asset.ext || "?"}
					</span>
				</div>
			);
	}
}

/**
 * Pan/zoom canvas host: the thumbnail bridges instantly, the original swaps
 * in once decoded — same geometry, no view reset.
 */
function ImageBody({
	asset,
	viewerRef,
	onScaleChange,
}: {
	asset: AssetSummary;
	viewerRef: React.RefObject<ViewerHandle | null>;
	onScaleChange: (scale: number) => void;
}) {
	const [originalSrc, setOriginalSrc] = useState<string | null>(null);

	useEffect(() => {
		const image = new Image();
		image.onload = () => setOriginalSrc(image.src);
		image.src = fileUrl(asset.id);
		return () => {
			image.onload = null;
		};
	}, [asset.id]);

	// viewerKindFor guarantees dimensions for "image"; keep TS honest.
	if (asset.width == null || asset.height == null) return null;

	return (
		<CanvasViewer
			ref={viewerRef}
			src={originalSrc ?? thumbUrl(asset.id)}
			alt={asset.name}
			imageWidth={asset.width}
			imageHeight={asset.height}
			onScaleChange={onScaleChange}
		/>
	);
}
