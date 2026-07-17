# Changelog

All notable changes to yAssets are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/); this project uses
[semantic versioning](https://semver.org/).

Each release's section below is published verbatim as its GitHub Release notes
(see `.github/workflows/release.yml`), so keep entries user-facing.

## [Unreleased]

## [0.1.20] - 2026-07-17

### Fixed

- **Watched folders no longer pop the Duplicate Files dialog on launch.** A
  watched folder's already-cataloged files were being surfaced as interactive
  duplicates during the startup rescan, so the dialog appeared on every restart.
  Automatic imports (watched folders) now skip already-imported files silently;
  the Duplicate Files dialog only opens for imports you start yourself
  (drag-drop, the file picker, or ⌘V paste).

## [0.1.19] - 2026-07-17

### Added

- **Save videos from the browser** — the [yClip](https://github.com/maosensen/yClip)
  extension can now hand videos to yAssets. Direct-file clips (UI galleries)
  import like images; streamed platform video (X/Twitter, TikTok, YouTube…) is
  downloaded by a **managed yt-dlp** — enable it once in Preferences ▸ Collect
  (a ~35 MB download from yt-dlp's official release, checksum-verified) and the
  source page is recorded as provenance.

### Fixed

- **The video downloader installs reliably.** The post-install self-check hung
  on the desktop async runtime (subprocess reaping); it now runs the same way
  as the rest of the app and reports real errors instead of spinning forever.
- Streamed-video downloads no longer leave an orphaned downloader running past
  a timeout, and the local import failure of a fetched file is no longer
  mislabeled as a network error.

## [0.1.18] - 2026-07-16

### Added

- **Collect from your browser** — yAssets can now receive captures from the new
  [yClip](https://github.com/maosensen/yClip) Chrome extension. Enable the
  local Collect API in Preferences ▸ Collect (off by default; loopback-only and
  token-protected), paste the token into yClip once, and right-click any image,
  link, or page — or ⌥+right-click an image — to save it straight into your
  library, with the source page recorded as provenance and duplicates detected
  as usual. Hotlink-protected images (cookie- or Referer-gated CDNs such as
  pixiv) are fetched inside the browser session and handed over as bytes.

## [0.1.17] - 2026-07-09

### Changed

- **What's New, redesigned** — each release now opens on a timeline with a
  version chip, a headline and a short summary, followed by a card of titled,
  categorized changes. All 17 releases got curated headlines in English,
  Chinese, and Japanese.

## [0.1.16] - 2026-07-09

### Added

- **Paste a URL to import** — press ⌘V with a web link on the clipboard and
  yAssets saves it as a bookmark: the page's Open Graph cover, title and address
  are captured (a generated card is used when a page has no cover). A direct
  image / video / PDF link imports as a normal file instead. Bookmarks show a
  **URL** badge with the site's host; double-click (or right-click ▸ Open) opens
  the live page in an in-app browser window — right-click ▸ Open in Browser uses
  your system browser.

## [0.1.15] - 2026-07-08

### Added

- **Discover: Openverse audio** — a media toggle (Images | Audio) on the
  Openverse source. Browse Creative-Commons music, sound effects, podcasts,
  and audiobooks with album art and duration badges, and import them straight
  into the library — attribution included.

### Fixed

- **Openverse illustrations render now** — SVG results (most of the
  illustration category) showed broken thumbnails because the Openverse
  thumbnail service can't process them; the app now loads the artwork
  directly. Any thumbnail that still fails shows a labeled tile instead of a
  broken-image icon.

## [0.1.14] - 2026-07-07

### Fixed

- **Context-menu actions work again** — the grid's rubber-band selection was
  silently capturing the pointer out from under the menu, so every action
  (Add to Folder, Export, Move to Trash, …) no-oped.
- **Sort menu no longer crashes** the window when opened.
- **Openverse loads now** — searches were being rejected outright (the
  anonymous API caps page size at 20; we asked for more). Rate limiting also
  gets a clearer message, and hitting it mid-scroll no longer blanks the
  results already on screen.
- **Imported icons are legible** — Iconify icons now import at their real
  size, and SVG thumbnails render sharp at full thumbnail resolution with
  monochrome (currentColor) artwork drawn in a visible neutral gray. The
  stored file is untouched and stays recolorable.

### Changed

- **Discover toolbar, two tiers** — sources on top; search plus each source's
  own filters below. Wallhaven: category / aspect / minimum resolution;
  Pixabay: type / orientation; Openverse: license / type / aspect;
  Pexels: orientation / size; Iconify: icon set / style.

## [0.1.13] - 2026-07-07

### Added

- **Discover: Iconify** — search 200,000+ open-source icons from 150+ sets and
  add them straight to your library as SVG. No API key. Imported icons keep
  their original color (recolorable), and record their set and license.

## [0.1.12] - 2026-07-07

### Added

- **Discover: Openverse and Pexels** — two more image sources. Openverse browses
  Creative-Commons and public-domain images with no API key; Pexels needs a free
  key (Preferences ▸ Discover). Imported images now record their attribution
  (creator and license) on the asset, for sources that ask for credit.

## [0.1.11] - 2026-07-07

### Added

- **What's New** — an in-app changelog. Open it from the menu bar (yAssets ▸
  What's New) or the library switcher to see the highlights of each release, in
  your language, with the version you're running badged.

### Changed

- **Preferences, redesigned** — a clearer layout with a titled section header,
  settings grouped into cards, and macOS-style segmented controls for theme and
  language.

## [0.1.10] - 2026-07-07

### Added

- **Discover: Pixabay** — a second source alongside Wallhaven. Switch providers
  from the Discover toolbar; Pixabay needs a free API key (Preferences ▸
  Discover), with Popular / Latest sorting.

## [0.1.9] - 2026-07-07

### Added

- **Discover** — browse Wallhaven from inside the app and add wallpapers straight
  to your library (each import records its source page). Search, sort, and
  multi-select; an optional Wallhaven API key (Preferences) unlocks NSFW/Sketchy
  content and a higher rate limit.

## [0.1.8] - 2026-07-07

### Added

- **Multi-language UI** — Simplified Chinese and Japanese alongside English, with
  a live language switcher in Preferences ▸ General. The choice is remembered and
  defaults to your system language.
- **Native macOS menu bar** — global actions where you expect them: yAssets ▸
  About / Check for Updates / Preferences (⌘,), plus standard Edit and Window
  menus.
- **About yAssets** card — app icon, version, and copyright, reachable from the
  menu bar and the library switcher.

### Changed

- Sidebar "add" buttons (Folders, Smart Folders) use a cleaner outline icon,
  aligned to the right edge.

## [0.1.7] - 2026-07-06

### Added

- Slideshow is now a proper modal dialog: focus is trapped and restored, and it
  reports its final position exactly once.

### Changed

- Internal i18n foundation so all copy is locale-swappable (groundwork for
  multi-language support).

## [0.1.6] - 2026-07-06

### Added

- **Handles large libraries** — the grid now pages results with infinite scroll
  (keyset pagination) instead of one giant load; Select All still selects the
  full matching set across pages.
- **Watched folders** — point yAssets at external folders (Preferences ▸ Watched
  Folders) and new files import automatically, nested folders and duplicates
  handled like a normal import.
- **Maintenance** (Preferences ▸ Maintenance) — compact the database (VACUUM),
  clean up orphaned files, and run an integrity check.

## [0.1.5] - 2026-07-06

### Added

- Thumbnails for more formats: PDF (first page), HEIC, TIFF, PSD, and
  Sketch/design containers.
- **Fullscreen slideshow / present mode** and **side-by-side compare** for the
  current selection.

## [0.1.4] - 2026-07-05

### Added

- Toolbar **sort** control (by date / name / size / rating, ascending or
  descending).
- **Full-text search** (FTS5) with faceted filters (rating, file type, tags).
- Batch rating and a folder picker in the multi-select panel.

### Fixed

- Release pipeline now publishes one release with all platforms attached.

## [0.1.3] - 2026-07-05

### Added

- Eagle-style **folder picker** for adding assets to folders.
- Better video cover-frame extraction, plus a "Regenerate Cover" action.

### Fixed

- Asset lists refresh correctly when switching color and smart-folder views.

## [0.1.2] - 2026-07-05

### Added

- Subfolder bar at the top of a folder view.
- File-type chips and type-based placeholders for assets without a thumbnail.
- HTML file preview; folder info panel in the inspector.
- Video duration badges and faster list-view cover generation.

### Fixed

- Unified scrollbar styling and a Windows white-scrollbar glitch.

## [0.1.1] - 2026-07-04

### Added

- Import a folder and keep its **nested folder structure**.
- Startup update notifications with one-click **Install & Restart**.

### Fixed

- Windows sidebar transparency (mica/acrylic) no longer washes out text.

## [0.1.0] - 2026-07-04

First public release — a local-first, cross-platform media/asset manager built
with Tauri 2.

### Added

- Library lifecycle, drag-and-drop **import pipeline** with content-hash dedupe
  and thumbnail generation.
- Virtualized masonry **grid**, folders, tags, trash, and search.
- **Inspector** with metadata, rating, color palette, notes, and source URL.
- **Preview** for images (pan/zoom), video, audio, Markdown/text, and PDF.
- Perceptual **duplicate detection** with an Eagle-style duplicate alert, a
  library-wide duplicates center, and **Find Similar**.
- **Smart folders** (rule-based live collections).
- Keyboard navigation (arrow keys, Space Quick Look, Enter to rename).
- Color extraction and filter-by-color; SVG thumbnails; asset export.
- Signed **self-update** pipeline across macOS, Windows, and Linux.

[Unreleased]: https://github.com/maosensen/yAssets/compare/v0.1.17...HEAD
[0.1.19]: https://github.com/maosensen/yAssets/releases/tag/v0.1.19
[0.1.18]: https://github.com/maosensen/yAssets/releases/tag/v0.1.18
[0.1.17]: https://github.com/maosensen/yAssets/releases/tag/v0.1.17
[0.1.16]: https://github.com/maosensen/yAssets/releases/tag/v0.1.16
[0.1.15]: https://github.com/maosensen/yAssets/releases/tag/v0.1.15
[0.1.14]: https://github.com/maosensen/yAssets/releases/tag/v0.1.14
[0.1.13]: https://github.com/maosensen/yAssets/releases/tag/v0.1.13
[0.1.12]: https://github.com/maosensen/yAssets/releases/tag/v0.1.12
[0.1.11]: https://github.com/maosensen/yAssets/releases/tag/v0.1.11
[0.1.10]: https://github.com/maosensen/yAssets/releases/tag/v0.1.10
[0.1.9]: https://github.com/maosensen/yAssets/releases/tag/v0.1.9
[0.1.8]: https://github.com/maosensen/yAssets/releases/tag/v0.1.8
[0.1.7]: https://github.com/maosensen/yAssets/releases/tag/v0.1.7
[0.1.6]: https://github.com/maosensen/yAssets/releases/tag/v0.1.6
[0.1.5]: https://github.com/maosensen/yAssets/releases/tag/v0.1.5
[0.1.4]: https://github.com/maosensen/yAssets/releases/tag/v0.1.4
[0.1.3]: https://github.com/maosensen/yAssets/releases/tag/v0.1.3
[0.1.2]: https://github.com/maosensen/yAssets/releases/tag/v0.1.2
[0.1.1]: https://github.com/maosensen/yAssets/releases/tag/v0.1.1
[0.1.0]: https://github.com/maosensen/yAssets/releases/tag/v0.1.0
