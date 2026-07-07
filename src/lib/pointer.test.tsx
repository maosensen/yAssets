/**
 * Regression coverage for the grid's marquee containment guard (the
 * context-menu "every action no-ops" bug): React-bubbled portal events must
 * be classified as OUTSIDE presses so the marquee never captures the pointer
 * out from under a popup's items.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { describe, expect, it } from "vitest";
import { pressWithin } from "./pointer";

describe("pressWithin", () => {
	it("classifies DOM containment, not React ancestry", () => {
		const container = document.createElement("div");
		const inner = document.createElement("span");
		container.appendChild(inner);
		const elsewhere = document.createElement("div");

		expect(pressWithin(container, inner)).toBe(true);
		expect(pressWithin(container, container)).toBe(true);
		expect(pressWithin(container, elsewhere)).toBe(false);
		expect(pressWithin(container, null)).toBe(false);
	});

	it("sees React-bubbled portal presses as outside the surface", () => {
		// The bug's exact mechanism: a portaled popup React-bubbles pointerdown
		// into the surface handler even though its DOM lives under body.
		const results: boolean[] = [];
		function Probe() {
			return (
				<div
					data-testid="surface"
					onPointerDown={(event) =>
						results.push(pressWithin(event.currentTarget, event.target))
					}
				>
					<span data-testid="inside">card</span>
					{createPortal(
						<button data-testid="portaled" type="button">
							menu item
						</button>,
						document.body,
					)}
				</div>
			);
		}
		render(<Probe />);

		// The portaled press MUST reach the handler (that's the React-bubbling
		// hazard) and MUST be classified as outside.
		fireEvent.pointerDown(screen.getByTestId("portaled"));
		fireEvent.pointerDown(screen.getByTestId("inside"));
		expect(results).toEqual([false, true]);
	});
});
