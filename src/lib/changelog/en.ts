import type { ChangelogRelease } from "./index";

export const en: ChangelogRelease[] = [
	{
		version: "0.1.23",
		date: "2026-07-21",
		title: "Sharper icons, steadier scrolling",
		summary:
			"A consistent icon set across the sidebar and toolbar, and the grid now keeps its place when you come back from an item.",
		changes: [
			{
				kind: "improved",
				title: "Even, consistent icons",
				text: "Sidebar and toolbar icons now share one uniform line weight instead of reading heavier or lighter than each other. The active sidebar item fills in (solid) to mark where you are.",
			},
			{
				kind: "fixed",
				title: "The grid keeps its place",
				text: "Opening an item and going back no longer jumps the grid to the top — it stays exactly where you were scrolled to, remembered per view.",
			},
		],
	},
	{
		version: "0.1.22",
		date: "2026-07-21",
		title: "Copy files out with ⌘C",
		summary:
			"Select assets, press ⌘C, and paste them into Finder, a browser, or a chat box — the mirror of ⌘V paste-import.",
		changes: [
			{
				kind: "new",
				title: "Copy to other apps",
				text: "Select one or more items and press ⌘C to put them on the clipboard, then paste into Finder, Chrome, or a chat box like Claude or ChatGPT — they arrive under their real names. Until now an in-app copy pasted nothing elsewhere.",
			},
		],
	},
	{
		version: "0.1.21",
		date: "2026-07-17",
		title: "Drag files anywhere",
		summary:
			"Drag items straight out of yAssets into Finder, a browser, or a chat box — and collected videos now get their cover instantly.",
		changes: [
			{
				kind: "new",
				title: "Drag out to other apps",
				text: "Drag one or more items out of the window and drop them into Finder, Chrome, or a chat box like Claude or ChatGPT — they arrive under their real names. Dropping onto a sidebar folder or the trash still works on the same drag.",
			},
			{
				kind: "fixed",
				title: "Instant covers for collected videos",
				text: "A video saved through yClip no longer waits until the next launch for its thumbnail and duration — the cover is generated as soon as it arrives.",
			},
		],
	},
	{
		version: "0.1.20",
		date: "2026-07-17",
		title: "A quieter startup",
		summary:
			"Watched folders no longer pop the Duplicate Files dialog every time you launch the app.",
		changes: [
			{
				kind: "fixed",
				title: "No more startup duplicate dialog",
				text: "A watched folder's existing files were being flagged as duplicates on every launch. Automatic imports now skip already-imported files silently — the Duplicate Files dialog only opens for imports you start yourself.",
			},
		],
	},
	{
		version: "0.1.19",
		date: "2026-07-17",
		title: "Videos, from the browser",
		summary:
			"yClip can now save videos too — direct clips like images, and streamed platform video (X, TikTok, YouTube) via a built-in downloader.",
		changes: [
			{
				kind: "new",
				title: "Video collecting",
				text: "Right-click or ⌥+right-click a video, or paste a link in yClip. Streamed platform video is fetched by a managed yt-dlp — turn it on once in Preferences ▸ Collect (checksum-verified, ~35 MB).",
			},
			{
				kind: "fixed",
				title: "Reliable downloader install",
				text: "Installing the video downloader no longer hangs silently, and download failures now report a clear reason.",
			},
		],
	},
	{
		version: "0.1.18",
		date: "2026-07-16",
		title: "Clip from your browser",
		summary:
			"The new yClip Chrome extension saves images, links, and pages from any website straight into your library.",
		changes: [
			{
				kind: "new",
				title: "Collect API + yClip",
				text: "Enable the local Collect API in Preferences ▸ Collect (off by default, token-protected), pair the yClip extension once, and right-click — or ⌥+right-click — anything on the web to save it with its source page recorded. Hotlink-protected images (like pixiv) are fetched inside your browser session.",
			},
		],
	},
	{
		version: "0.1.17",
		date: "2026-07-09",
		title: "A fresh What's New",
		summary: "The page you're reading right now got a redesign.",
		changes: [
			{
				kind: "improved",
				title: "Release-notes layout",
				text: "Each release now opens on a timeline with a version chip, a headline and a short summary, followed by titled, categorized changes.",
			},
		],
	},
	{
		version: "0.1.16",
		date: "2026-07-09",
		title: "Bookmark the web",
		summary:
			"Paste any link with ⌘V and yAssets turns it into a first-class asset — cover, title, and a built-in browser to revisit the page.",
		changes: [
			{
				kind: "new",
				title: "Paste a URL",
				text: "Press ⌘V with a link on the clipboard to save it as a bookmark, with the page's cover and title. Double-click opens the live page in an in-app browser; a direct image or video link imports as a file.",
			},
		],
	},
	{
		version: "0.1.15",
		date: "2026-07-08",
		title: "Openverse, now with sound",
		summary:
			"Discover grows beyond images: Creative-Commons audio joins the catalog, and SVG illustrations render properly.",
		changes: [
			{
				kind: "new",
				title: "Audio mode",
				text: "Openverse gains an audio mode — browse Creative-Commons music, sound effects, podcasts, and audiobooks, with duration badges.",
			},
			{
				kind: "fixed",
				title: "Illustration thumbnails",
				text: "Openverse illustrations (SVG artwork) render in the grid instead of showing broken thumbnails.",
			},
		],
	},
	{
		version: "0.1.14",
		date: "2026-07-07",
		title: "A tidier Discover",
		summary:
			"A reorganized Discover toolbar, plus a round of fixes for menus, Openverse, and icon imports.",
		changes: [
			{
				kind: "improved",
				title: "Two-tier toolbar",
				text: "Discover gets a two-tier toolbar: sources on top, search plus each source's own filters below.",
			},
			{
				kind: "fixed",
				title: "Context menus & sorting",
				text: "Right-click menu actions work again, and the sort menu no longer crashes.",
			},
			{
				kind: "fixed",
				title: "Openverse & icon clarity",
				text: "Openverse loads now, and imported icons are sharp and visible in both themes.",
			},
		],
	},
	{
		version: "0.1.13",
		date: "2026-07-07",
		title: "Icons by the hundred thousand",
		summary:
			"Iconify joins Discover — 200,000+ open-source icons, imported as recolorable SVG.",
		changes: [
			{
				kind: "new",
				title: "Discover: Iconify",
				text: "Discover adds Iconify — search 200,000+ open-source icons and add them to your library as SVG, no key required.",
			},
		],
	},
	{
		version: "0.1.12",
		date: "2026-07-07",
		title: "Two more sources",
		summary:
			"Openverse and Pexels join Discover, and every import now remembers its creator and license.",
		changes: [
			{
				kind: "new",
				title: "Openverse & Pexels",
				text: "Discover adds Openverse (Creative-Commons, no key) and Pexels (free key) alongside Wallhaven and Pixabay.",
			},
			{
				kind: "improved",
				title: "Attribution on import",
				text: "Imported images now record their attribution — creator and license — for sources that ask for credit.",
			},
		],
	},
	{
		version: "0.1.11",
		date: "2026-07-07",
		title: "What's New, literally",
		summary:
			"The changelog you're reading right now, plus a redesigned Preferences.",
		changes: [
			{
				kind: "new",
				title: "In-app changelog",
				text: "What's New — an in-app changelog you can open from the menu bar to see each release's highlights.",
			},
			{
				kind: "improved",
				title: "Preferences refresh",
				text: "Preferences has a fresh layout: a titled section header, settings grouped into cards, and segmented controls for theme and language.",
			},
		],
	},
	{
		version: "0.1.10",
		date: "2026-07-07",
		title: "Pixabay joins Discover",
		summary: "A second image source, one toolbar switch away.",
		changes: [
			{
				kind: "new",
				title: "Discover: Pixabay",
				text: "Discover now includes Pixabay alongside Wallhaven — switch sources from the toolbar.",
			},
		],
	},
	{
		version: "0.1.9",
		date: "2026-07-07",
		title: "Introducing Discover",
		summary:
			"Browse third-party sources without leaving the app — Wallhaven is first.",
		changes: [
			{
				kind: "new",
				title: "Discover view",
				text: "New Discover view: browse Wallhaven and add wallpapers straight into your library, with the source recorded.",
			},
		],
	},
	{
		version: "0.1.8",
		date: "2026-07-07",
		title: "In your language",
		summary: "A localized interface, and a proper macOS citizen.",
		changes: [
			{
				kind: "new",
				title: "Chinese & Japanese UI",
				text: "Simplified Chinese and Japanese interface, with a live language switcher in Preferences.",
			},
			{
				kind: "new",
				title: "macOS menu bar & About",
				text: "Native macOS menu bar and an About window.",
			},
		],
	},
	{
		version: "0.1.7",
		date: "2026-07-06",
		title: "Slideshow, refined",
		summary: "A focused accessibility pass on the slideshow.",
		changes: [
			{
				kind: "improved",
				title: "Accessible slideshow",
				text: "The slideshow is now a fully accessible modal, with proper focus handling.",
			},
		],
	},
	{
		version: "0.1.6",
		date: "2026-07-06",
		title: "Ready for big libraries",
		summary:
			"Smooth scrolling at scale, hands-free imports, and tools to keep the library healthy.",
		changes: [
			{
				kind: "improved",
				title: "Infinite scroll",
				text: "Large libraries load smoothly with infinite scroll.",
			},
			{
				kind: "new",
				title: "Watched folders",
				text: "Watched folders import new files automatically.",
			},
			{
				kind: "new",
				title: "Maintenance tools",
				text: "Maintenance tools: compact the database, clean up orphans, and verify integrity.",
			},
		],
	},
	{
		version: "0.1.5",
		date: "2026-07-06",
		title: "More ways to look",
		summary:
			"Design-file thumbnails, plus fullscreen slideshow and side-by-side compare.",
		changes: [
			{
				kind: "new",
				title: "More thumbnails",
				text: "Thumbnails for PDF, HEIC, TIFF, PSD and Sketch files.",
			},
			{
				kind: "new",
				title: "Slideshow & compare",
				text: "Fullscreen slideshow and side-by-side compare.",
			},
		],
	},
	{
		version: "0.1.4",
		date: "2026-07-05",
		title: "Sort, search, rate",
		summary:
			"Find anything: toolbar sorting, full-text search with filters, and batch rating.",
		changes: [
			{
				kind: "new",
				title: "Sorting, search & rating",
				text: "Toolbar sorting, full-text search with filters, and batch rating.",
			},
		],
	},
	{
		version: "0.1.3",
		date: "2026-07-05",
		title: "A better folder picker",
		summary: "Organizing gets quicker, and video covers get sharper.",
		changes: [
			{
				kind: "new",
				title: "Eagle-style folder picker",
				text: "An Eagle-style folder picker.",
			},
			{
				kind: "improved",
				title: "Sharper video covers",
				text: "Sharper video cover frames.",
			},
		],
	},
	{
		version: "0.1.2",
		date: "2026-07-05",
		title: "Browsing niceties",
		summary: "Small touches across the grid, previews, and the inspector.",
		changes: [
			{
				kind: "new",
				title: "Subfolders, chips & HTML preview",
				text: "Subfolder bar, file-type chips, HTML preview, and a folder info panel.",
			},
		],
	},
	{
		version: "0.1.1",
		date: "2026-07-04",
		title: "Structure intact",
		summary:
			"Folder imports keep their nesting, and new releases announce themselves.",
		changes: [
			{
				kind: "new",
				title: "Nested folder import",
				text: "Import folders while keeping their structure.",
			},
			{
				kind: "new",
				title: "Update notifications",
				text: "Automatic update notifications.",
			},
		],
	},
	{
		version: "0.1.0",
		date: "2026-07-04",
		title: "Hello, yAssets",
		summary:
			"The first release of a local-first media library, built to stay yours.",
		changes: [
			{
				kind: "new",
				title: "A local-first library",
				text: "First release — a local-first media library: import, organize, tag, preview, de-duplicate, and self-update.",
			},
		],
	},
];
