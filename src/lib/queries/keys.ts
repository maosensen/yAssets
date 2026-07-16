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
		/** Hue bucket for view=color — without it every color collides. */
		hue?: number;
		/** Smart-folder id for view=smart — without it every rule set collides. */
		smartFolderId?: string;
		q?: string;
		/** Ad-hoc facets (orthogonal to view) — must be in the key too. */
		ratingMin?: number;
		types?: string[];
		tags?: string[];
		sortBy: string;
		sortDir: string;
	}) => ["assets", "list", params] as const,
	detail: (id: string) => ["assets", "detail", id] as const,
	/** dHash neighborhood of one asset (view=similar). */
	similar: (id: string) => ["assets", "similar", id] as const,
	/** Folders containing ALL of these assets (folder-picker checked state).
	 *  Prefixed by `all`, so membership mutations invalidate it. */
	folderMembership: (ids: readonly string[]) =>
		["assets", "folder-membership", [...ids].sort()] as const,
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

export const watchedFolderKeys = {
	all: ["watched-folders"] as const,
};

export const maintenanceKeys = {
	report: ["maintenance", "report"] as const,
};

export const collectKeys = {
	/** Collect API status (enabled/running/port/token) — Preferences ▸ Collect. */
	status: ["collect", "status"] as const,
};

export const sourceKeys = {
	/** Discover search results. The API key is part of the key so changing it
	 *  (e.g. fixing an invalid one) refetches; react-query keys are in-memory
	 *  only, and the key already lives in the persisted sources store. */
	search: (params: {
		provider: string;
		query: string;
		filters: unknown;
		apiKey: string | null;
	}) => ["sources", "search", params] as const,
};
