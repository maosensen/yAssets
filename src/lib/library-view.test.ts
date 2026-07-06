import { describe, expect, it } from "vitest";
import {
	type LibraryView,
	libraryViewSchema,
	RECENT_DAYS,
	scopeFromView,
} from "./library-view";

/** A full LibraryView with only `view` overridden — the rest default to undefined. */
function view(
	over: Partial<LibraryView> & Pick<LibraryView, "view">,
): LibraryView {
	return over as LibraryView;
}

describe("scopeFromView", () => {
	it("maps each populated view kind to its scope", () => {
		expect(scopeFromView(view({ view: "folder", folderId: "f1" }))).toEqual({
			kind: "folder",
			folder_id: "f1",
		});
		expect(scopeFromView(view({ view: "tag", tagId: "t1" }))).toEqual({
			kind: "tag",
			tag_id: "t1",
		});
		expect(scopeFromView(view({ view: "color", hue: 0 }))).toEqual({
			kind: "color",
			hue: 0,
		});
		expect(scopeFromView(view({ view: "smart", smartId: "s1" }))).toEqual({
			kind: "smart_folder",
			smart_folder_id: "s1",
		});
		expect(scopeFromView(view({ view: "uncategorized" }))).toEqual({
			kind: "uncategorized",
		});
		expect(scopeFromView(view({ view: "untagged" }))).toEqual({
			kind: "untagged",
		});
		expect(scopeFromView(view({ view: "trash" }))).toEqual({ kind: "trash" });
		expect(scopeFromView(view({ view: "recent" }))).toEqual({
			kind: "recent",
			days: RECENT_DAYS,
		});
	});

	it("falls back to {all} when a scoped view is missing its id/param", () => {
		expect(scopeFromView(view({ view: "folder" }))).toEqual({ kind: "all" });
		expect(scopeFromView(view({ view: "tag" }))).toEqual({ kind: "all" });
		expect(scopeFromView(view({ view: "color" }))).toEqual({ kind: "all" });
		expect(scopeFromView(view({ view: "smart" }))).toEqual({ kind: "all" });
	});

	it("treats hue=0 as present (not falsy-dropped)", () => {
		// Regression guard: `view.hue !== undefined`, not `if (view.hue)`.
		expect(scopeFromView(view({ view: "color", hue: 0 }))).toEqual({
			kind: "color",
			hue: 0,
		});
	});

	it("maps `all` and the list-bypassing `similar` view to {all}", () => {
		expect(scopeFromView(view({ view: "all" }))).toEqual({ kind: "all" });
		expect(scopeFromView(view({ view: "similar", similarTo: "a1" }))).toEqual({
			kind: "all",
		});
	});
});

describe("libraryViewSchema", () => {
	it("defaults/catches an invalid or missing view to 'all'", () => {
		expect(libraryViewSchema.parse({}).view).toBe("all");
		expect(libraryViewSchema.parse({ view: "bogus" }).view).toBe("all");
	});

	it("coerces numeric params from strings (URL search params)", () => {
		expect(libraryViewSchema.parse({ view: "color", hue: "7" }).hue).toBe(7);
		expect(libraryViewSchema.parse({ rating: "3" }).rating).toBe(3);
	});

	it("accepts the boundary values and rejects out-of-range facets", () => {
		expect(
			libraryViewSchema.safeParse({ view: "color", hue: 12 }).success,
		).toBe(true);
		expect(
			libraryViewSchema.safeParse({ view: "color", hue: 13 }).success,
		).toBe(false);
		expect(libraryViewSchema.safeParse({ rating: 0 }).success).toBe(false);
		expect(libraryViewSchema.safeParse({ rating: 5 }).success).toBe(true);
	});

	it("parses array facets (types/tags)", () => {
		const parsed = libraryViewSchema.parse({
			view: "all",
			types: ["image", "video"],
			tags: ["t1"],
		});
		expect(parsed.types).toEqual(["image", "video"]);
		expect(parsed.tags).toEqual(["t1"]);
	});
});
