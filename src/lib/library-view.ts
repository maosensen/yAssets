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
		.enum(["all", "uncategorized", "recent", "trash", "folder"])
		.catch("all"),
	folderId: z.string().optional(),
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
		case "uncategorized":
			return { kind: "uncategorized" };
		case "recent":
			return { kind: "recent", days: RECENT_DAYS };
		case "trash":
			return { kind: "trash" };
		default:
			return { kind: "all" };
	}
}
