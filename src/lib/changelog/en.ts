import type { ChangelogRelease } from "./index";

export const en: ChangelogRelease[] = [
	{
		version: "0.1.16",
		date: "2026-07-09",
		changes: [
			{
				kind: "new",
				text: "Paste a URL — press ⌘V with a link on the clipboard to save it as a bookmark, with the page's cover and title. Double-click opens the live page in an in-app browser; a direct image or video link imports as a file.",
			},
		],
	},
	{
		version: "0.1.15",
		date: "2026-07-08",
		changes: [
			{
				kind: "new",
				text: "Openverse gains an audio mode — browse Creative-Commons music, sound effects, podcasts, and audiobooks, with duration badges.",
			},
			{
				kind: "fixed",
				text: "Openverse illustrations (SVG artwork) render in the grid instead of showing broken thumbnails.",
			},
		],
	},
	{
		version: "0.1.14",
		date: "2026-07-07",
		changes: [
			{
				kind: "improved",
				text: "Discover gets a two-tier toolbar: sources on top, search plus each source's own filters below.",
			},
			{
				kind: "fixed",
				text: "Right-click menu actions work again, and the sort menu no longer crashes.",
			},
			{
				kind: "fixed",
				text: "Openverse loads now, and imported icons are sharp and visible in both themes.",
			},
		],
	},
	{
		version: "0.1.13",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "Discover adds Iconify — search 200,000+ open-source icons and add them to your library as SVG, no key required.",
			},
		],
	},
	{
		version: "0.1.12",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "Discover adds Openverse (Creative-Commons, no key) and Pexels (free key) alongside Wallhaven and Pixabay.",
			},
			{
				kind: "improved",
				text: "Imported images now record their attribution — creator and license — for sources that ask for credit.",
			},
		],
	},
	{
		version: "0.1.11",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "What's New — an in-app changelog you can open from the menu bar to see each release's highlights.",
			},
			{
				kind: "improved",
				text: "Preferences has a fresh layout: a titled section header, settings grouped into cards, and segmented controls for theme and language.",
			},
		],
	},
	{
		version: "0.1.10",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "Discover now includes Pixabay alongside Wallhaven — switch sources from the toolbar.",
			},
		],
	},
	{
		version: "0.1.9",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "New Discover view: browse Wallhaven and add wallpapers straight into your library, with the source recorded.",
			},
		],
	},
	{
		version: "0.1.8",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "Simplified Chinese and Japanese interface, with a live language switcher in Preferences.",
			},
			{
				kind: "new",
				text: "Native macOS menu bar and an About window.",
			},
		],
	},
	{
		version: "0.1.7",
		date: "2026-07-06",
		changes: [
			{
				kind: "improved",
				text: "The slideshow is now a fully accessible modal, with proper focus handling.",
			},
		],
	},
	{
		version: "0.1.6",
		date: "2026-07-06",
		changes: [
			{
				kind: "improved",
				text: "Large libraries load smoothly with infinite scroll.",
			},
			{
				kind: "new",
				text: "Watched folders import new files automatically.",
			},
			{
				kind: "new",
				text: "Maintenance tools: compact the database, clean up orphans, and verify integrity.",
			},
		],
	},
	{
		version: "0.1.5",
		date: "2026-07-06",
		changes: [
			{
				kind: "new",
				text: "Thumbnails for PDF, HEIC, TIFF, PSD and Sketch files.",
			},
			{
				kind: "new",
				text: "Fullscreen slideshow and side-by-side compare.",
			},
		],
	},
	{
		version: "0.1.4",
		date: "2026-07-05",
		changes: [
			{
				kind: "new",
				text: "Toolbar sorting, full-text search with filters, and batch rating.",
			},
		],
	},
	{
		version: "0.1.3",
		date: "2026-07-05",
		changes: [
			{ kind: "new", text: "An Eagle-style folder picker." },
			{ kind: "improved", text: "Sharper video cover frames." },
		],
	},
	{
		version: "0.1.2",
		date: "2026-07-05",
		changes: [
			{
				kind: "new",
				text: "Subfolder bar, file-type chips, HTML preview, and a folder info panel.",
			},
		],
	},
	{
		version: "0.1.1",
		date: "2026-07-04",
		changes: [
			{
				kind: "new",
				text: "Import folders while keeping their structure.",
			},
			{ kind: "new", text: "Automatic update notifications." },
		],
	},
	{
		version: "0.1.0",
		date: "2026-07-04",
		changes: [
			{
				kind: "new",
				text: "First release — a local-first media library: import, organize, tag, preview, de-duplicate, and self-update.",
			},
		],
	},
];
