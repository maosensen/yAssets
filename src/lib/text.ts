/**
 * All user-facing copy (incl. aria-labels, toasts, confirmations) lives here —
 * components never hardcode display strings.
 *
 * Conventions:
 * - Grouped by domain; interpolation always via functions
 * - Error-code → copy mapping lives in the `errors` group (see `describeError`)
 * - Split by domain once this file outgrows ~300 lines
 */

/** "3 items" / "1 item" — naive pluralizer for regular nouns. */
const counted = (n: number, noun: string) =>
	`${n} ${n === 1 ? noun : `${noun}s`}`;

export const T = {
	app: {
		name: "yAssets",
	},
	common: {
		cancel: "Cancel",
		confirm: "Confirm",
		remove: "Remove",
		loading: "Loading…",
	},
	preferences: {
		title: "Preferences",
		open: "Preferences…",
		navGeneral: "General",
		sectionAppearance: "Appearance",
		theme: "Theme",
		themeLight: "Light",
		themeDark: "Dark",
		themeSystem: "System",
	},
	welcome: {
		tagline: "Local-first asset library",
		createLibrary: "New Library",
		openLibrary: "Open Library",
		pickCreateTitle: "Choose where to create the library (empty folder)",
		pickOpenTitle: "Choose a library folder",
		recentTitle: "Recent",
		recentEmpty: "No Recent Libraries",
		recentEmptyHint: "Libraries you create or open will show up here.",
		missingBadge: "Moved or deleted",
		removeRecent: "Remove from list",
		opening: "Opening…",
	},
	toolbar: {
		back: "Back",
		forward: "Forward",
		searchPlaceholder: "Search",
		zoom: "Thumbnail size",
	},
	sidebar: {
		all: "All",
		uncategorized: "Uncategorized",
		untagged: "Untagged",
		recent: "Recently Added",
		trash: "Trash",
		foldersTitle: "Folders",
		newFolder: "New Folder",
		tagsTitle: "Tags",
		filterPlaceholder: "Filter…",
		collapse: "Collapse",
		expand: "Expand",
		switcher: {
			openOther: "Open Other Library…",
			createNew: "New Library…",
			closeCurrent: "Close Current Library",
			recentGroup: "Recent",
		},
	},
	folderDialog: {
		createTitle: "New Folder",
		createChildTitle: (parent: string) => `New folder in “${parent}”`,
		renameTitle: "Rename Folder",
		namePlaceholder: "Folder name",
		createAction: "Create",
		renameAction: "Rename",
	},
	folderMenu: {
		newSubfolder: "New Subfolder",
		rename: "Rename",
		delete: "Delete Folder",
		deleteTitle: (name: string) => `Delete folder “${name}”?`,
		deleteDesc:
			"Its subfolders will be deleted too. Assets are kept and return to Uncategorized.",
		deleteAction: "Delete",
	},
	assetMenu: {
		addToFolder: "Add to Folder",
		noFolders: "No folders yet",
		removeFromFolder: "Remove from This Folder",
		reveal: "Reveal in Finder",
		export: "Export",
		trash: "Move to Trash",
		restore: "Restore",
		deleteForever: "Delete Permanently…",
	},
	trashUi: {
		emptyTrash: "Empty Trash",
		itemsInTrash: (n: number) => `${counted(n, "item")} in Trash`,
		confirmEmptyTitle: "Empty Trash?",
		confirmEmptyDesc:
			"All assets in the Trash will be permanently deleted. This cannot be undone.",
		confirmDeleteTitle: "Delete Permanently?",
		confirmDeleteDesc: (n: number) =>
			n > 1
				? `${n} assets will be permanently deleted. This cannot be undone.`
				: "This asset will be permanently deleted. This cannot be undone.",
		confirmAction: "Delete Permanently",
	},
	viewTitles: {
		all: "All",
		uncategorized: "Uncategorized",
		untagged: "Untagged",
		recent: "Recently Added",
		trash: "Trash",
		folderFallback: "Folder",
		tagFallback: "Tag",
		color: "By Color",
		searchPrefix: (q: string) => `Search: ${q}`,
	},
	tags: {
		addPlaceholder: "Search or create a tag…",
		newTag: "New Tag",
		createEntry: (name: string) => `Create “${name}”`,
		noTags: "No tags yet",
		removeFromAsset: "Remove this tag",
		rename: "Rename",
		editColor: "Set Color",
		delete: "Delete Tag",
		deleteTitle: (name: string) => `Delete tag “${name}”?`,
		deleteDesc: "Assets are kept — only the tag itself is removed.",
		deleteAction: "Delete",
		editTitle: "Edit Tag",
		nameLabel: "Name",
		colorLabel: "Color",
		colorNone: "None",
		saveAction: "Save",
	},
	/** Per-view empty states — title + supporting hint (unified EmptyState). */
	gridEmpty: {
		noSearchResult: {
			title: "No Results",
			hint: "Nothing matches your search. Try different keywords.",
		},
		folderEmpty: {
			title: "Empty Folder",
			hint: "Drop files here, or drag cards from other views into this folder.",
		},
		uncategorizedEmpty: {
			title: "All Organized",
			hint: "Every asset belongs to at least one folder.",
		},
		untaggedEmpty: {
			title: "No Untagged Assets",
			hint: "Every asset has at least one tag.",
		},
		tagEmpty: {
			title: "No Assets with This Tag",
			hint: "Tag assets from the inspector and they will show up here.",
		},
		colorEmpty: {
			title: "No Assets in This Color",
			hint: "Try another swatch, or clear the color filter.",
		},
		recentEmpty: {
			title: "Nothing Recent",
			hint: "Assets imported in the last 30 days show up here.",
		},
		trashEmpty: {
			title: "Trash is Empty",
			hint: "Deleted assets are kept here until you empty the trash.",
		},
	},
	grid: {
		emptyTitle: "Drop Files Here",
		emptyHint: "Drag in files or folders — or paste from the clipboard.",
	},
	export: {
		pickTitle: "Choose export destination",
		action: "Export",
		actionN: (n: number) => `Export (${n})`,
		done: (n: number) => `Exported ${counted(n, "item")}`,
		empty: "Nothing to export",
	},
	colorFilter: {
		label: "Color",
		all: "All Colors",
		neutral: "Black & White",
	},
	import: {
		started: "Preparing import…",
		discovering: (total: number) => `Scanning files… (${total} found)`,
		progress: (done: number, total: number) => `Importing ${done}/${total}…`,
		finished: (imported: number, skipped: number) =>
			skipped > 0
				? `Imported ${counted(imported, "item")}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}`
				: `Imported ${counted(imported, "item")}`,
		finishedWithFailures: (imported: number, skipped: number, failed: number) =>
			`Imported ${imported}, failed ${failed}${skipped > 0 ? `, skipped ${skipped}` : ""}`,
		cancelled: (imported: number) => `Import cancelled (${imported} completed)`,
		dropHint: "Drop to import into this library",
		importFiles: "Import Files",
		importFolder: "Import Folder",
		pasteEmpty: "Clipboard has nothing importable",
	},
	inspector: {
		emptyTitle: "No Selection",
		emptyHint: "Select an asset to view and edit its details.",
		notePlaceholder: "Notes…",
		ratingLabel: "Rating",
		starLabel: (n: number) => counted(n, "star"),
		foldersLabel: "Folders",
		addToFolder: "Add to Folder",
		removeFromThisFolder: "Remove from this folder",
		infoTitle: "Properties",
		infoDimensions: "Dimensions",
		infoSize: "Size",
		infoFormat: "Type",
		infoImported: "Date Imported",
		infoCreated: "Date Created",
		infoModified: "Date Modified",
		infoSource: "Source",
		exportAction: "Export",
		exportSoon: "Coming soon",
		itemCount: (n: number) => counted(n, "item"),
	},
	drag: {
		count: (n: number) => counted(n, "item"),
	},
	multi: {
		title: (n: number) => `${n} selected`,
		trash: (n: number) => `Move to Trash (${n})`,
		restore: (n: number) => `Restore (${n})`,
	},
	preview: {
		close: "Close preview",
		prev: "Previous",
		next: "Next",
		counter: (current: number, total: number) => `${current} / ${total}`,
	},
	errorPage: {
		title: "Something Went Wrong",
		hint: "The interface hit an unexpected error. Go back home to keep working — if it persists, reload the app.",
		goHome: "Back to Home",
		reload: "Reload App",
		detailsLabel: "Error details",
	},
	errors: {
		NotFound: "Target file or folder not found",
		Io: "File read/write failed",
		Db: "Database error",
		NoLibraryOpen: "No library is open",
		LibraryIncompatible:
			"Not a valid library folder, or it was created by a newer version of the app",
		Conflict: "The operation conflicts with the current state",
		Internal: "An internal error occurred",
		unknown: "An unknown error occurred",
		withDetail: (summary: string, detail: string) => `${summary} (${detail})`,
	},
} as const;
