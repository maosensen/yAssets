import type { ChangelogRelease } from "./index";

export const en: ChangelogRelease[] = [
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
