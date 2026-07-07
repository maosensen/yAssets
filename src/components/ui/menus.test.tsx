/**
 * Regression tests for Base UI menu wrappers.
 *
 * - Base UI 1.6 `Menu.GroupLabel` throws ("Base UI error #31") unless it is
 *   inside `Menu.Group`/`Menu.RadioGroup`. Our label wrappers must therefore
 *   be self-contained, or every menu with a bare label crashes on open
 *   (the toolbar sort menu did exactly that in production).
 * - Context-menu items must invoke their onClick when activated.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

describe("DropdownMenu", () => {
	it("opens a menu that has a bare label without crashing", async () => {
		render(
			<DropdownMenu>
				<DropdownMenuTrigger>Sort</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuLabel>Sort by</DropdownMenuLabel>
					<DropdownMenuRadioGroup value="name" onValueChange={() => {}}>
						<DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>,
		);
		fireEvent.click(screen.getByText("Sort"));
		expect(await screen.findByText("Sort by")).toBeInTheDocument();
		expect(screen.getByText("Name")).toBeInTheDocument();
	});

	it("radio items select on click", async () => {
		const onValueChange = vi.fn();
		render(
			<DropdownMenu>
				<DropdownMenuTrigger>Sort</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuRadioGroup value="name" onValueChange={onValueChange}>
						<DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>,
		);
		fireEvent.click(screen.getByText("Sort"));
		fireEvent.click(await screen.findByText("Size"));
		expect(onValueChange).toHaveBeenCalledWith("size", expect.anything());
	});
});

describe("ContextMenu", () => {
	it("opens on right-click and fires item onClick", async () => {
		const onAction = vi.fn();
		render(
			<ContextMenu>
				<ContextMenuTrigger>
					<div>card</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onClick={onAction}>Add to Folder</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("card"));
		const item = await screen.findByText("Add to Folder");
		fireEvent.click(item);
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("fires item onClick under a realistic pointer sequence", async () => {
		// A real click is pointerdown → mousedown → pointerup → mouseup → click.
		// This pins the MENU side only (dismiss logic must not misfire on the
		// item's own pointerdown); the grid-side marquee/pointer-capture bug is
		// pinned by src/lib/pointer.test.tsx (jsdom has no capture retargeting,
		// so it cannot be reproduced here end to end).
		const onAction = vi.fn();
		render(
			<ContextMenu>
				<ContextMenuTrigger>
					<div>card</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onClick={onAction}>Export</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>,
		);
		const card = screen.getByText("card");
		fireEvent.pointerDown(card, {
			button: 2,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.contextMenu(card);
		fireEvent.pointerUp(card, {
			button: 2,
			pointerId: 1,
			pointerType: "mouse",
		});

		const item = await screen.findByText("Export");
		fireEvent.pointerDown(item, {
			button: 0,
			pointerId: 2,
			pointerType: "mouse",
		});
		fireEvent.mouseDown(item, { button: 0 });
		fireEvent.pointerUp(item, {
			button: 0,
			pointerId: 2,
			pointerType: "mouse",
		});
		fireEvent.mouseUp(item, { button: 0 });
		fireEvent.click(item, { button: 0, detail: 1 });
		expect(onAction).toHaveBeenCalledTimes(1);
	});
});
