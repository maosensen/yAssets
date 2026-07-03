/**
 * Free pan/zoom image canvas for the preview route.
 *
 * Interaction model (macOS-first):
 * - trackpad pinch (WebKit reports it as ctrlKey+wheel) → zoom anchored at
 *   the cursor; plain two-finger scroll / mouse wheel → pan
 * - pointer drag → pan (pointer capture)
 * - double-click → toggle fit ↔ 100%; buttons/shortcuts drive the same ops
 *
 * Coordinate system: the <img> is laid out at the asset's DB dimensions and
 * transformed with translate+scale (origin 0,0) — so `scale` IS the display
 * ratio (1 = 100% pixels), and the progressive thumb→original source swap
 * shares the same geometry without any state reset.
 *
 * Wheel listeners must be non-passive (we preventDefault to stop page
 * scroll/rubber-banding), so they're attached natively in an effect — React's
 * synthetic onWheel is passive at the root.
 */

import {
	type Ref,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";

/** Imperative surface for the topbar controls / keyboard shortcuts. */
export type ViewerHandle = {
	zoomIn: () => void;
	zoomOut: () => void;
	zoomToFit: () => void;
	zoomToActual: () => void;
};

type CanvasViewerProps = {
	/** Current best source (thumbnail first, original once decoded). */
	src: string;
	alt: string;
	/** Natural dimensions from the DB — the layout coordinate system. */
	imageWidth: number;
	imageHeight: number;
	/** Reports the display ratio (1 = 100%) whenever it changes. */
	onScaleChange?: (scale: number) => void;
	ref?: Ref<ViewerHandle>;
};

const MAX_SCALE = 8;
const MIN_SCALE = 0.02;
const STEP = 1.25;
/** Pinch-zoom sensitivity (scale factor per wheel delta unit). */
const PINCH_K = 0.01;

type View = { scale: number; tx: number; ty: number; mode: "fit" | "free" };

export function CanvasViewer({
	src,
	alt,
	imageWidth,
	imageHeight,
	onScaleChange,
	ref,
}: CanvasViewerProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [box, setBox] = useState({ w: 0, h: 0 });
	const [view, setView] = useState<View>({
		scale: 0,
		tx: 0,
		ty: 0,
		mode: "fit",
	});
	const [dragging, setDragging] = useState(false);

	// Track the container size (panel resizes, window resizes).
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() => {
			setBox({ w: el.clientWidth, h: el.clientHeight });
		});
		observer.observe(el);
		setBox({ w: el.clientWidth, h: el.clientHeight });
		return () => observer.disconnect();
	}, []);

	const fitScale = useCallback(() => {
		if (box.w === 0 || box.h === 0) return 1;
		// Fit never upscales small images past 100%.
		return Math.min(box.w / imageWidth, box.h / imageHeight, 1);
	}, [box.w, box.h, imageWidth, imageHeight]);

	const centered = useCallback(
		(scale: number): View => ({
			scale,
			tx: (box.w - imageWidth * scale) / 2,
			ty: (box.h - imageHeight * scale) / 2,
			mode: "fit",
		}),
		[box.w, box.h, imageWidth, imageHeight],
	);

	// (Re-)fit when the container size lands/changes while in fit mode.
	useEffect(() => {
		if (box.w === 0 || box.h === 0) return;
		setView((current) =>
			current.mode === "fit" ? centered(fitScale()) : current,
		);
	}, [box.w, box.h, centered, fitScale]);

	useEffect(() => {
		if (view.scale > 0) onScaleChange?.(view.scale);
	}, [view.scale, onScaleChange]);

	const clampScale = useCallback(
		(value: number) =>
			Math.min(MAX_SCALE, Math.max(Math.min(MIN_SCALE, fitScale()), value)),
		[fitScale],
	);

	/** Zoom keeping the container point (px, py) fixed on the image. */
	const zoomAt = useCallback(
		(px: number, py: number, factor: number) => {
			setView((current) => {
				const scale = clampScale(current.scale * factor);
				const k = scale / current.scale;
				return {
					scale,
					tx: px - (px - current.tx) * k,
					ty: py - (py - current.ty) * k,
					mode: "free",
				};
			});
		},
		[clampScale],
	);

	const zoomCentered = useCallback(
		(factor: number) => zoomAt(box.w / 2, box.h / 2, factor),
		[zoomAt, box.w, box.h],
	);

	const zoomToFit = useCallback(
		() => setView(centered(fitScale())),
		[centered, fitScale],
	);
	const zoomToActual = useCallback(
		() => setView({ ...centered(1), mode: "free" }),
		[centered],
	);

	useImperativeHandle(
		ref,
		() => ({
			zoomIn: () => zoomCentered(STEP),
			zoomOut: () => zoomCentered(1 / STEP),
			zoomToFit,
			zoomToActual,
		}),
		[zoomCentered, zoomToFit, zoomToActual],
	);

	// Non-passive wheel: pinch (ctrlKey) zooms at the cursor, scroll pans.
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = el.getBoundingClientRect();
			if (event.ctrlKey) {
				const factor = Math.exp(-event.deltaY * PINCH_K);
				zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
			} else {
				setView((current) => ({
					...current,
					tx: current.tx - event.deltaX,
					ty: current.ty - event.deltaY,
					mode: "free",
				}));
			}
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [zoomAt]);

	// Pointer drag → pan.
	const dragState = useRef({ x: 0, y: 0 });
	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		dragState.current = { x: event.clientX, y: event.clientY };
		setDragging(true);
	};
	const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!dragging) return;
		const dx = event.clientX - dragState.current.x;
		const dy = event.clientY - dragState.current.y;
		dragState.current = { x: event.clientX, y: event.clientY };
		setView((current) => ({
			...current,
			tx: current.tx + dx,
			ty: current.ty + dy,
			mode: "free",
		}));
	};
	const endDrag = () => setDragging(false);

	const onDoubleClick = () => {
		// Near the fit ratio → jump to 100%; otherwise back to fit.
		if (Math.abs(view.scale - fitScale()) < 0.001) zoomToActual();
		else zoomToFit();
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: pan/zoom canvas surface — keyboard equivalents live in the preview route
		<div
			ref={containerRef}
			className="relative h-full w-full touch-none select-none overflow-hidden"
			style={{ cursor: dragging ? "grabbing" : "grab" }}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onDoubleClick={onDoubleClick}
		>
			{view.scale > 0 && (
				<img
					src={src}
					alt={alt}
					draggable={false}
					className="absolute top-0 left-0"
					style={{
						width: imageWidth,
						height: imageHeight,
						maxWidth: "none",
						transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
						transformOrigin: "0 0",
						willChange: "transform",
						imageRendering: view.scale >= 3 ? "pixelated" : "auto",
					}}
				/>
			)}
		</div>
	);
}
