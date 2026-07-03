/**
 * Geometry tests for the pan/zoom canvas — the math is what matters here:
 * fit-and-center initialization, cursor-anchored pinch zoom, drag panning.
 * jsdom has no layout/ResizeObserver, so container size is mocked at 800×600.
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { CanvasViewer } from "./canvas-viewer";

beforeAll(() => {
	class MockResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", MockResizeObserver);
	Object.defineProperty(HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get: () => 800,
	});
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => 600,
	});
	HTMLElement.prototype.setPointerCapture = () => {};
	HTMLElement.prototype.releasePointerCapture = () => {};
});

afterEach(() => cleanup());

const surface = (container: HTMLElement) =>
	container.firstElementChild as HTMLElement;
const image = () => document.querySelector("img") as HTMLImageElement;

test("initializes fitted and centered, never upscaling small images", () => {
	const onScale = vi.fn();
	render(
		<CanvasViewer
			src="x.webp"
			alt="wide"
			imageWidth={1600}
			imageHeight={600}
			onScaleChange={onScale}
		/>,
	);
	// fit = min(800/1600, 600/600, 1) = 0.5 → centered at (0, 150).
	expect(image().style.transform).toBe("translate(0px, 150px) scale(0.5)");
	expect(onScale).toHaveBeenLastCalledWith(0.5);

	cleanup();
	render(
		<CanvasViewer
			src="s.webp"
			alt="small"
			imageWidth={200}
			imageHeight={100}
		/>,
	);
	// Small image: fit clamps at 100%, centered.
	expect(image().style.transform).toBe("translate(300px, 250px) scale(1)");
});

test("pinch (ctrl+wheel) zooms anchored at the cursor", () => {
	const { container } = render(
		<CanvasViewer src="x.webp" alt="a" imageWidth={800} imageHeight={600} />,
	);
	// fit = 1, tx = ty = 0. Pinch in at the origin: the anchor point (0,0)
	// must stay put, so translate stays (0,0) while scale grows.
	fireEvent.wheel(surface(container), {
		ctrlKey: true,
		deltaY: -100,
		clientX: 0,
		clientY: 0,
	});
	const match = image().style.transform.match(
		/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/,
	);
	expect(match).not.toBeNull();
	const [, tx, ty, scale] = match as RegExpMatchArray;
	expect(Number.parseFloat(scale)).toBeCloseTo(Math.E, 2); // e^(100*0.01)
	expect(Number.parseFloat(tx)).toBeCloseTo(0, 5);
	expect(Number.parseFloat(ty)).toBeCloseTo(0, 5);
});

test("plain wheel pans; drag pans with pointer capture", () => {
	const { container } = render(
		<CanvasViewer src="x.webp" alt="a" imageWidth={800} imageHeight={600} />,
	);
	fireEvent.wheel(surface(container), { deltaX: 30, deltaY: -20 });
	expect(image().style.transform).toBe("translate(-30px, 20px) scale(1)");

	fireEvent.pointerDown(surface(container), {
		button: 0,
		clientX: 100,
		clientY: 100,
	});
	fireEvent.pointerMove(surface(container), { clientX: 140, clientY: 90 });
	fireEvent.pointerUp(surface(container));
	expect(image().style.transform).toBe("translate(10px, 10px) scale(1)");
});

test("double-click toggles fit and 100%", () => {
	const onScale = vi.fn();
	const { container } = render(
		<CanvasViewer
			src="x.webp"
			alt="a"
			imageWidth={1600}
			imageHeight={1200}
			onScaleChange={onScale}
		/>,
	);
	expect(onScale).toHaveBeenLastCalledWith(0.5); // fit
	fireEvent.doubleClick(surface(container));
	expect(onScale).toHaveBeenLastCalledWith(1); // actual
	fireEvent.doubleClick(surface(container));
	expect(onScale).toHaveBeenLastCalledWith(0.5); // back to fit
});
