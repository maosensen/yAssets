/**
 * react-query key factory — the single vocabulary for cache invalidation.
 *
 * Invalidation matrix (who invalidates what) lives with the mutation
 * factories in each domain file; keys here stay purely structural.
 */

export const libraryKeys = {
	/** The currently open library (`null` when none). */
	current: ["library", "current"] as const,
	/** Recently opened libraries for welcome screen / switcher. */
	recent: ["library", "recent"] as const,
	/** Sidebar badge counters. */
	stats: ["library", "stats"] as const,
};

export const assetKeys = {
	all: ["assets"] as const,
	list: (params: {
		view: string;
		folderId?: string;
		tagId?: string;
		q?: string;
		sortBy: string;
		sortDir: string;
	}) => ["assets", "list", params] as const,
	detail: (id: string) => ["assets", "detail", id] as const,
	/** dHash neighborhood of one asset (view=similar). */
	similar: (id: string) => ["assets", "similar", id] as const,
};

export const folderKeys = {
	all: ["folders"] as const,
	/** Per-folder item/size aggregate (prefixed by `all`, so folder/asset
	 *  invalidations catch it). */
	stats: (id: string) => ["folders", "stats", id] as const,
};

export const smartFolderKeys = {
	all: ["smart-folders"] as const,
};

export const tagKeys = {
	all: ["tags"] as const,
};
