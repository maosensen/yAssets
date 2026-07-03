/**
 * Shared vocabulary for the "/" library view: the zod search schema and the
 * search → `AssetScope` mapping. Used by both the grid route and the preview
 * route so they resolve the exact same ordered list (prev/next in preview
 * matches the grid the user came from) off one cached query.
 */

import { z } from "zod";
import type { AssetScope } from "@/lib/bindings";

export const libraryViewSchema = z.object({
	view: z
		.enum([
			"all",
			"uncategorized",
			"untagged",
			"recent",
			"trash",
			"folder",
			"tag",
			"color",
			"similar",
		])
		.catch("all"),
	folderId: z.string().optional(),
	tagId: z.string().optional(),
	/** Hue bucket for view=color (0-11 chromatic, 12 neutral). */
	hue: z.coerce.number().int().min(0).max(12).optional(),
	/** Reference asset for view=similar (dHash neighborhood). */
	similarTo: z.string().optional(),
	q: z.string().optional(),
});

export type LibraryView = z.infer<typeof libraryViewSchema>;

/** "Recent" window, in days. */
export const RECENT_DAYS = 30;

export function scopeFromView(view: LibraryView): AssetScope {
	switch (view.view) {
		case "folder":
			return view.folderId
				? { kind: "folder", folder_id: view.folderId }
				: { kind: "all" };
		case "tag":
			return view.tagId ? { kind: "tag", tag_id: view.tagId } : { kind: "all" };
		case "color":
			return view.hue !== undefined
				? { kind: "color", hue: view.hue }
				: { kind: "all" };
		case "uncategorized":
			return { kind: "uncategorized" };
		case "untagged":
			return { kind: "untagged" };
		case "recent":
			return { kind: "recent", days: RECENT_DAYS };
		case "trash":
			return { kind: "trash" };
		// view=similar bypasses list_assets entirely (its own ranked query —
		// see similarAssetsQueryOptions); this mapping is never consulted.
		case "similar":
			return { kind: "all" };
		default:
			return { kind: "all" };
	}
}
