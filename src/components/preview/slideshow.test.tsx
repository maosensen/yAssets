/**
 * Slideshow a11y regression tests: the overlay must behave like a real modal —
 * it exposes a dialog role, traps Tab focus, restores focus on close, and
 * reports its close exactly once (Esc / fullscreen-exit must not double-fire
 * onClose). jsdom has no Fullscreen API; the component's optional-chained calls
 * simply no-op, which is what we want here.
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AssetSummary } from "@/lib/bindings";

// `@/lib/media` calls Tauri's convertFileSrc, whose IPC internals don't exist in
// jsdom; the slideshow only needs *some* URL string per asset.
vi.mock("@/lib/media", () => ({
	fileUrl: (id: string) => `file:${id}`,
	thumbUrl: (id: string) => `thumb:${id}`,
}));

import { Slideshow } from "./slideshow";

afterEach(() => cleanup());

function asset(id: string): AssetSummary {
	return { id, name: `${id}.png`, ext: "png" } as unknown as AssetSummary;
}

const items = [asset("a"), asset("b"), asset("c")];

test("renders as a labelled modal dialog", () => {
	const { getByRole } = render(
		<Slideshow items={items} startIndex={0} onClose={vi.fn()} />,
	);
	const dialog = getByRole("dialog", { name: "Slideshow" });
	expect(dialog).toHaveAttribute("aria-modal", "true");
});

test("moves focus into the dialog on open and restores it on close", () => {
	const outside = document.createElement("button");
	document.body.appendChild(outside);
	outside.focus();
	expect(document.activeElement).toBe(outside);

	const { unmount, getByRole } = render(
		<Slideshow items={items} startIndex={0} onClose={vi.fn()} />,
	);
	// Focus is pulled off the launcher and into the overlay.
	expect(document.activeElement).toBe(getByRole("dialog"));

	unmount();
	expect(document.activeElement).toBe(outside);
	outside.remove();
});

test("reports close exactly once, even on a repeated Escape", () => {
	const onClose = vi.fn();
	render(<Slideshow items={items} startIndex={1} onClose={onClose} />);

	fireEvent.keyDown(document, { key: "Escape" });
	fireEvent.keyDown(document, { key: "Escape" });

	expect(onClose).toHaveBeenCalledTimes(1);
	expect(onClose).toHaveBeenCalledWith(1); // the index we stopped on
});

test("traps Tab focus inside the dialog (wraps last → first)", () => {
	const { getAllByRole } = render(
		<Slideshow items={items} startIndex={0} onClose={vi.fn()} />,
	);
	const buttons = getAllByRole("button");
	const first = buttons[0];
	const last = buttons[buttons.length - 1];

	last?.focus();
	expect(document.activeElement).toBe(last);
	fireEvent.keyDown(last as HTMLElement, { key: "Tab" });
	expect(document.activeElement).toBe(first);

	// Shift+Tab from the first wraps back to the last.
	first?.focus();
	fireEvent.keyDown(first as HTMLElement, { key: "Tab", shiftKey: true });
	expect(document.activeElement).toBe(last);
});

test("keeps focus inside when tabbing from the dialog container itself", () => {
	// The container holds focus immediately after open (tabIndex=-1). Both Tab
	// and Shift+Tab from there must stay in the modal — Shift+Tab must not fall
	// through to the controls rendered behind the overlay.
	const { getByRole, getAllByRole } = render(
		<Slideshow items={items} startIndex={0} onClose={vi.fn()} />,
	);
	const dialog = getByRole("dialog");
	const buttons = getAllByRole("button");
	const first = buttons[0];
	const last = buttons[buttons.length - 1];

	expect(document.activeElement).toBe(dialog);
	fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
	expect(document.activeElement).toBe(last);

	dialog.focus();
	fireEvent.keyDown(dialog, { key: "Tab" });
	expect(document.activeElement).toBe(first);
});
