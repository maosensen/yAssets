/**
 * Central icon registry — Solar "Linear" compiled at build time by
 * unplugin-icons (offline SVG components, tree-shaken).
 *
 * One variant only: Linear is a uniform, fill-free stroke, so perceived weight
 * stays even across glyphs (Line Duotone's per-glyph fill area made icons read
 * heavier/lighter at sidebar/toolbar sizes). Emphasis, if ever needed, should
 * come from a systematic rule (e.g. a bold variant for the active state), never
 * from mixing variants ad hoc.
 *
 * Components import icons from HERE by semantic name, never from `~icons/*`
 * directly — so the whole icon language stays swappable in one file, and an
 * action (e.g. "restore") always renders the same glyph everywhere.
 */

import type { ComponentType, SVGProps } from "react";

/** Shape of a compiled icon — for components that take icons as props. */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

// Actions
export {
	default as IconPlus,
	default as IconAdd,
} from "~icons/solar/add-circle-linear";
export { default as IconFolderAdd } from "~icons/solar/add-folder-linear";
// Navigation / chrome
export { default as IconChevronLeft } from "~icons/solar/alt-arrow-left-linear";
export { default as IconChevronRight } from "~icons/solar/alt-arrow-right-linear";
export { default as IconArchive } from "~icons/solar/archive-linear";
// Status (toasts, error page, menu indicators)
export {
	default as IconSuccess,
	default as IconCheck,
} from "~icons/solar/check-circle-linear";
export { default as IconRecent } from "~icons/solar/clock-circle-linear";
export { default as IconClose } from "~icons/solar/close-circle-linear";
export { default as IconCode } from "~icons/solar/code-linear";
// Discover (browse third-party sources).
export { default as IconDiscover } from "~icons/solar/compass-linear";
export { default as IconCopy } from "~icons/solar/copy-linear";
export { default as IconError } from "~icons/solar/danger-circle-linear";
export { default as IconWarning } from "~icons/solar/danger-triangle-linear";
export { default as IconFileText } from "~icons/solar/document-text-linear";
export { default as IconExport } from "~icons/solar/export-linear";
// File-type placeholders (grid cards for assets without a thumbnail)
export { default as IconFile } from "~icons/solar/file-linear";
export { default as IconPdf } from "~icons/solar/file-text-linear";
export { default as IconFilter } from "~icons/solar/filter-linear";
// Folders
export { default as IconFolder } from "~icons/solar/folder-linear";
export { default as IconFolderOpen } from "~icons/solar/folder-open-linear";
export { default as IconFullscreen } from "~icons/solar/full-screen-linear";
export { default as IconImportImages } from "~icons/solar/gallery-add-linear";
// Smart views / sidebar
export {
	default as IconImageFile,
	default as IconAll,
} from "~icons/solar/gallery-linear";
// "What's New" / changelog.
export { default as IconChangelog } from "~icons/solar/history-linear";
export { default as IconHome } from "~icons/solar/home-2-linear";
export { default as IconUncategorized } from "~icons/solar/inbox-linear";
export { default as IconInfo } from "~icons/solar/info-circle-linear";
export { default as IconMulti } from "~icons/solar/layers-linear";
export { default as IconLibrary } from "~icons/solar/library-linear";
// Link asset — a bookmark imported from a pasted URL.
export { default as IconLink } from "~icons/solar/link-linear";
export { default as IconMagic } from "~icons/solar/magic-stick-3-linear";
export { default as IconSearch } from "~icons/solar/magnifer-linear";
export { default as IconExitFullscreen } from "~icons/solar/minimize-linear";
export { default as IconMinus } from "~icons/solar/minus-circle-linear";
// Theme chips
export { default as IconMonitor } from "~icons/solar/monitor-linear";
export { default as IconMoon } from "~icons/solar/moon-linear";
export { default as IconFolderImport } from "~icons/solar/move-to-folder-linear";
export { default as IconMusic } from "~icons/solar/music-note-2-linear";
export { default as IconPalette } from "~icons/solar/palette-linear";
export { default as IconPause } from "~icons/solar/pause-circle-linear";
// Preview / present-mode controls (C 组 — viewing experience).
export { default as IconPlay } from "~icons/solar/play-circle-linear";
export { default as IconRadio } from "~icons/solar/record-circle-linear";
export { default as IconReload } from "~icons/solar/restart-linear";
export { default as IconSettings } from "~icons/solar/settings-linear";
export { default as IconSort } from "~icons/solar/sort-vertical-linear";
export { default as IconReveal } from "~icons/solar/square-top-up-linear";
export { default as IconStar } from "~icons/solar/star-linear";
export { default as IconSun } from "~icons/solar/sun-2-linear";
export { default as IconTag } from "~icons/solar/tag-linear";
export { default as IconSwitcher } from "~icons/solar/transfer-vertical-linear";
export { default as IconTrash } from "~icons/solar/trash-bin-trash-linear";
export { default as IconRestore } from "~icons/solar/undo-left-round-linear";
export { default as IconVideo } from "~icons/solar/videocamera-linear";
export { default as IconCompare } from "~icons/solar/widget-2-linear";
