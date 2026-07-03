/**
 * Central icon registry — Solar "Bold Duotone" compiled at build time by
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
export { default as IconPlus } from "~icons/solar/add-circle-bold-duotone";
export { default as IconFolderAdd } from "~icons/solar/add-folder-bold-duotone";
// Navigation / chrome
export { default as IconChevronLeft } from "~icons/solar/alt-arrow-left-bold-duotone";
export { default as IconChevronRight } from "~icons/solar/alt-arrow-right-bold-duotone";
// Status (toasts, error page, menu indicators)
export {
	default as IconSuccess,
	default as IconCheck,
} from "~icons/solar/check-circle-bold-duotone";
export { default as IconRecent } from "~icons/solar/clock-circle-bold-duotone";
export { default as IconClose } from "~icons/solar/close-circle-bold-duotone";
export { default as IconError } from "~icons/solar/danger-circle-bold-duotone";
export { default as IconWarning } from "~icons/solar/danger-triangle-bold-duotone";
export { default as IconExport } from "~icons/solar/export-bold-duotone";
// Folders
export { default as IconFolder } from "~icons/solar/folder-bold-duotone";
export { default as IconFolderOpen } from "~icons/solar/folder-open-bold-duotone";
export { default as IconImportImages } from "~icons/solar/gallery-add-bold-duotone";
// Smart views / sidebar
export { default as IconAll } from "~icons/solar/gallery-bold-duotone";
export { default as IconHome } from "~icons/solar/home-2-bold-duotone";
export { default as IconUncategorized } from "~icons/solar/inbox-bold-duotone";
export { default as IconInfo } from "~icons/solar/info-circle-bold-duotone";
export { default as IconMulti } from "~icons/solar/layers-bold-duotone";
export { default as IconLibrary } from "~icons/solar/library-bold-duotone";
export { default as IconSearch } from "~icons/solar/magnifer-bold-duotone";
// Theme chips
export { default as IconMonitor } from "~icons/solar/monitor-bold-duotone";
export { default as IconMoon } from "~icons/solar/moon-bold-duotone";
export { default as IconFolderImport } from "~icons/solar/move-to-folder-bold-duotone";
export { default as IconPalette } from "~icons/solar/palette-bold-duotone";
export { default as IconRadio } from "~icons/solar/record-circle-bold-duotone";
export { default as IconReload } from "~icons/solar/restart-bold-duotone";
export { default as IconSettings } from "~icons/solar/settings-bold-duotone";
export { default as IconReveal } from "~icons/solar/square-top-up-bold-duotone";
export { default as IconStar } from "~icons/solar/star-bold-duotone";
export { default as IconSun } from "~icons/solar/sun-2-bold-duotone";
export { default as IconTag } from "~icons/solar/tag-bold-duotone";
export { default as IconSwitcher } from "~icons/solar/transfer-vertical-bold-duotone";
export { default as IconTrash } from "~icons/solar/trash-bin-trash-bold-duotone";
export { default as IconRestore } from "~icons/solar/undo-left-round-bold-duotone";
