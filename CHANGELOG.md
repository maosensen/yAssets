# Changelog

All notable changes to yAssets are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/); this project uses
[semantic versioning](https://semver.org/).

Each release's section below is published verbatim as its GitHub Release notes
(see `.github/workflows/release.yml`), so keep entries user-facing.

## [Unreleased]

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

[Unreleased]: https://github.com/maosensen/yAssets/compare/v0.1.9...HEAD
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
