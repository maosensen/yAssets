/**
 * Fullscreen slideshow / present mode. Cycles the SAME list the preview walks
 * (so it respects the current view + sort + filters), auto-advancing while
 * playing and looping at the ends. Chrome auto-hides after the mouse goes idle;
 * Esc — or exiting OS fullscreen — closes and reports the final index so the
 * preview underneath lands on the asset you stopped on.
 *
 * Rendering is a single contain-fit <img>: the full-quality original for
 * WebView-decodable images, otherwise the generated cover (video poster / PDF
 * page / design preview). A slideshow shows covers — it doesn't play media.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	IconChevronLeft,
	IconChevronRight,
	IconClose,
	IconExitFullscreen,
	IconFullscreen,
	IconPause,
	IconPlay,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { AssetSummary } from "@/lib/bindings";
import { fileUrl, thumbUrl } from "@/lib/media";
import { useCoverBustStore } from "@/lib/stores/cover-bust-store";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";
import { canDecodeNativeImage } from "@/lib/viewer-registry";

/** Auto-advance interval while playing. */
const SLIDE_MS = 4000;
/** Hide chrome + cursor after this much mouse idle. */
const CHROME_IDLE_MS = 2500;

/** Full-quality src for native-decodable images; the cover for everything else
 *  (cover-bust token applied so a regenerated cover shows through). */
function slideSrc(
	asset: AssetSummary,
	tokens: ReadonlyMap<string, number>,
): string {
	if (canDecodeNativeImage(asset.ext)) return fileUrl(asset.id);
	const base = thumbUrl(asset.id);
	const token = tokens.get(asset.id);
	return token ? `${base}?v=${token}` : base;
}

export function Slideshow({
	items,
	startIndex,
	onClose,
}: {
	items: AssetSummary[];
	startIndex: number;
	onClose: (finalIndex: number) => void;
}) {
	const [index, setIndex] = useState(startIndex);
	const [playing, setPlaying] = useState(true);
	const [chromeVisible, setChromeVisible] = useState(true);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const tokens = useCoverBustStore((state) => state.tokens);

	const count = items.length;
	const current = items[index];

	// Latest index for the close callback / fullscreen listeners (stable refs).
	const indexRef = useRef(index);
	indexRef.current = index;
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	const go = useCallback(
		(delta: number) => {
			if (count === 0) return;
			setIndex((i) => (i + delta + count) % count);
		},
		[count],
	);

	// onClose must fire exactly once. `close()` reports it directly, but exiting
	// OS fullscreen ALSO reports it (fullscreenchange fires asynchronously, after
	// exitFullscreen resolves) — so a close-while-fullscreen would otherwise call
	// onClose twice. This guard collapses every close path to a single call.
	const closedRef = useRef(false);
	const finish = useCallback((finalIndex: number) => {
		if (closedRef.current) return;
		closedRef.current = true;
		onCloseRef.current(finalIndex);
	}, []);

	const close = useCallback(() => {
		if (document.fullscreenElement)
			void document.exitFullscreen().catch(() => {});
		finish(indexRef.current);
	}, [finish]);

	// Auto-advance at a steady cadence while playing (functional update, so no
	// dependency on the current index).
	useEffect(() => {
		if (!playing || count <= 1) return;
		const timer = window.setInterval(() => {
			setIndex((i) => (i + 1) % count);
		}, SLIDE_MS);
		return () => window.clearInterval(timer);
	}, [playing, count]);

	// Keep the index in range if the underlying list shrinks under us (e.g. an
	// asset gets trashed elsewhere while paused); close if it empties entirely.
	// Without this a stale out-of-range index renders nothing while the overlay
	// stays mounted, swallowing keys behind an invisible modal.
	useEffect(() => {
		if (count === 0) {
			finish(0);
			return;
		}
		setIndex((i) => (i >= count ? count - 1 : i));
	}, [count, finish]);

	// Modal focus management: pull focus into the overlay on mount so keys land
	// here, and restore it to whatever launched the slideshow (the preview's
	// launch button) on unmount.
	useEffect(() => {
		const previouslyFocused = document.activeElement as HTMLElement | null;
		containerRef.current?.focus();
		return () => previouslyFocused?.focus?.();
	}, []);

	// Request OS fullscreen on mount (the launch click supplies the gesture);
	// if it's blocked the fixed overlay still gives an in-app present mode.
	// Exiting OS fullscreen (Esc / green button) closes the slideshow.
	useEffect(() => {
		const el = containerRef.current;
		el?.requestFullscreen?.().catch(() => {});
		const onFsChange = () => {
			const fs = document.fullscreenElement != null;
			setIsFullscreen(fs);
			if (!fs) finish(indexRef.current);
		};
		document.addEventListener("fullscreenchange", onFsChange);
		return () => {
			document.removeEventListener("fullscreenchange", onFsChange);
			if (document.fullscreenElement)
				void document.exitFullscreen().catch(() => {});
		};
	}, [finish]);

	// Keyboard (capture phase so it wins over the preview route's handler, which
	// also no-ops while the slideshow is mounted).
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				close();
			} else if (event.key === "ArrowRight") {
				setPlaying(false);
				go(1);
			} else if (event.key === "ArrowLeft") {
				setPlaying(false);
				go(-1);
			} else if (event.key === " ") {
				event.preventDefault();
				setPlaying((p) => !p);
			} else if (event.key === "Tab") {
				// Trap focus inside the modal; reveal the chrome so the control the
				// user is tabbing to is actually visible (it auto-hides on idle).
				const root = containerRef.current;
				if (root) {
					setChromeVisible(true);
					trapTabFocus(root, event);
				}
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [close, go]);

	// Chrome + cursor auto-hide on idle; any mouse move wakes it.
	useEffect(() => {
		let idle = 0;
		const wake = () => {
			setChromeVisible(true);
			window.clearTimeout(idle);
			idle = window.setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
		};
		wake();
		window.addEventListener("mousemove", wake);
		return () => {
			window.clearTimeout(idle);
			window.removeEventListener("mousemove", wake);
		};
	}, []);

	// Preload the next slide so advancing doesn't flash.
	useEffect(() => {
		if (count <= 1) return;
		const next = items[(index + 1) % count];
		if (next) {
			const img = new Image();
			img.src = slideSrc(next, tokens);
		}
	}, [index, count, items, tokens]);

	const toggleFullscreen = () => {
		if (document.fullscreenElement)
			void document.exitFullscreen().catch(() => {});
		else containerRef.current?.requestFullscreen?.().catch(() => {});
	};

	if (!current) return null;

	return (
		<div
			ref={containerRef}
			role="dialog"
			aria-modal="true"
			aria-label={T.preview.slideshow}
			tabIndex={-1}
			className={cn(
				"fixed inset-0 z-[95] flex flex-col bg-black outline-none",
				!chromeVisible && "cursor-none",
			)}
		>
			<div className="flex min-h-0 flex-1 items-center justify-center p-6">
				{/* key forces a fresh element per asset so the browser never shows
				    the previous frame stretched while the next decodes. */}
				<img
					key={current.id}
					src={slideSrc(current, tokens)}
					alt={current.name}
					className="max-h-full max-w-full object-contain"
					draggable={false}
				/>
			</div>

			{/* Top strip: filename + counter + close. */}
			<div
				className={cn(
					"pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 transition-opacity",
					chromeVisible ? "opacity-100" : "opacity-0",
				)}
			>
				<span
					className="min-w-0 truncate text-sm text-white/90"
					title={current.name}
				>
					{current.name}
				</span>
				<span className="shrink-0 text-white/60 text-xs tabular-nums">
					{T.preview.counter(index + 1, count)}
				</span>
			</div>

			{/* Bottom control strip. */}
			<div
				className={cn(
					"-translate-x-1/2 absolute bottom-6 left-1/2 flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 backdrop-blur-md transition-opacity",
					chromeVisible ? "opacity-100" : "opacity-0",
					!chromeVisible && "pointer-events-none",
				)}
			>
				<SlideButton label={T.preview.prev} onClick={() => go(-1)}>
					<IconChevronLeft className="size-5" />
				</SlideButton>
				<SlideButton
					label={playing ? T.preview.pause : T.preview.play}
					onClick={() => setPlaying((p) => !p)}
				>
					{playing ? (
						<IconPause className="size-6" />
					) : (
						<IconPlay className="size-6" />
					)}
				</SlideButton>
				<SlideButton label={T.preview.next} onClick={() => go(1)}>
					<IconChevronRight className="size-5" />
				</SlideButton>
				<div className="mx-1 h-5 w-px bg-white/20" />
				<SlideButton
					label={isFullscreen ? T.preview.exitFullscreen : T.preview.fullscreen}
					onClick={toggleFullscreen}
				>
					{isFullscreen ? (
						<IconExitFullscreen className="size-5" />
					) : (
						<IconFullscreen className="size-5" />
					)}
				</SlideButton>
				<SlideButton label={T.preview.exit} onClick={close}>
					<IconClose className="size-5" />
				</SlideButton>
			</div>
		</div>
	);
}

/** Keep Tab focus inside the modal, wrapping around at both ends. Called from
 *  the capture-phase key handler so it fires even when focus has escaped. */
function trapTabFocus(root: HTMLElement, event: KeyboardEvent) {
	const focusables = Array.from(
		root.querySelectorAll<HTMLElement>(
			'button, [href], input, [tabindex]:not([tabindex="-1"])',
		),
	).filter((el) => !el.hasAttribute("disabled"));
	if (focusables.length === 0) {
		event.preventDefault();
		root.focus();
		return;
	}
	const first = focusables[0];
	const last = focusables[focusables.length - 1];
	const active = document.activeElement;
	// The dialog container itself holds focus right after open (tabIndex=-1, so
	// it's never in `focusables`). Treat it — and anything outside the modal — as
	// a boundary, otherwise the default Shift+Tab would walk to a control behind
	// the overlay and escape the trap.
	const atBoundary = active === root || !root.contains(active);
	if (event.shiftKey) {
		if (atBoundary || active === first) {
			event.preventDefault();
			last?.focus();
		}
	} else if (atBoundary || active === last) {
		event.preventDefault();
		first?.focus();
	}
}

function SlideButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			aria-label={label}
			title={label}
			className="size-9 rounded-full text-white/80 hover:bg-white/15 hover:text-white"
			onClick={onClick}
		>
			{children}
		</Button>
	);
}
