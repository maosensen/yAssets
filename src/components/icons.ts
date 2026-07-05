/**
 * Central icon registry — Solar "Line Duotone" compiled at build time by
 * unplugin-icons (offline SVG components, tree-shaken).
 *
 * Components import icons from HERE by semantic name, never from `~icons/*`
 * directly — so the whole icon language stays swappable in one file, and an
 * action (e.g. "restore") always renders the same glyph everywhere.
 */

import type { ComponentType, SVGProps } from "react";

/** Shape of a compiled icon — for components that take icons as props. */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

// Actions
export { default as IconPlus } from "~icons/solar/add-circle-line-duotone";
export { default as IconFolderAdd } from "~icons/solar/add-folder-line-duotone";
// Navigation / chrome
export { default as IconChevronLeft } from "~icons/solar/alt-arrow-left-line-duotone";
export { default as IconChevronRight } from "~icons/solar/alt-arrow-right-line-duotone";
export { default as IconArchive } from "~icons/solar/archive-line-duotone";
// Status (toasts, error page, menu indicators)
export {
	default as IconSuccess,
	default as IconCheck,
} from "~icons/solar/check-circle-line-duotone";
export { default as IconRecent } from "~icons/solar/clock-circle-line-duotone";
export { default as IconClose } from "~icons/solar/close-circle-line-duotone";
export { default as IconCode } from "~icons/solar/code-line-duotone";
export { default as IconCopy } from "~icons/solar/copy-line-duotone";
export { default as IconError } from "~icons/solar/danger-circle-line-duotone";
export { default as IconWarning } from "~icons/solar/danger-triangle-line-duotone";
export { default as IconFileText } from "~icons/solar/document-text-line-duotone";
export { default as IconExport } from "~icons/solar/export-line-duotone";
// File-type placeholders (grid cards for assets without a thumbnail)
export { default as IconFile } from "~icons/solar/file-line-duotone";
export { default as IconPdf } from "~icons/solar/file-text-line-duotone";
export { default as IconFilter } from "~icons/solar/filter-line-duotone";
// Folders
export { default as IconFolder } from "~icons/solar/folder-line-duotone";
export { default as IconFolderOpen } from "~icons/solar/folder-open-line-duotone";
export { default as IconImportImages } from "~icons/solar/gallery-add-line-duotone";
// Smart views / sidebar
export {
	default as IconImageFile,
	default as IconAll,
} from "~icons/solar/gallery-line-duotone";
export { default as IconHome } from "~icons/solar/home-2-line-duotone";
export { default as IconUncategorized } from "~icons/solar/inbox-line-duotone";
export { default as IconInfo } from "~icons/solar/info-circle-line-duotone";
export { default as IconMulti } from "~icons/solar/layers-line-duotone";
export { default as IconLibrary } from "~icons/solar/library-line-duotone";
export { default as IconMagic } from "~icons/solar/magic-stick-3-line-duotone";
export { default as IconSearch } from "~icons/solar/magnifer-line-duotone";
export { default as IconMinus } from "~icons/solar/minus-circle-line-duotone";
// Theme chips
export { default as IconMonitor } from "~icons/solar/monitor-line-duotone";
export { default as IconMoon } from "~icons/solar/moon-line-duotone";
export { default as IconFolderImport } from "~icons/solar/move-to-folder-line-duotone";
export { default as IconMusic } from "~icons/solar/music-note-2-line-duotone";
export { default as IconPalette } from "~icons/solar/palette-line-duotone";
export { default as IconRadio } from "~icons/solar/record-circle-line-duotone";
export { default as IconReload } from "~icons/solar/restart-line-duotone";
export { default as IconSettings } from "~icons/solar/settings-line-duotone";
export { default as IconReveal } from "~icons/solar/square-top-up-line-duotone";
export { default as IconStar } from "~icons/solar/star-line-duotone";
export { default as IconSun } from "~icons/solar/sun-2-line-duotone";
export { default as IconTag } from "~icons/solar/tag-line-duotone";
export { default as IconSwitcher } from "~icons/solar/transfer-vertical-line-duotone";
export { default as IconTrash } from "~icons/solar/trash-bin-trash-line-duotone";
export { default as IconRestore } from "~icons/solar/undo-left-round-line-duotone";
export { default as IconVideo } from "~icons/solar/videocamera-line-duotone";
