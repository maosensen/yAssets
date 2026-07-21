/**
 * Curated folder-icon catalog — the pickable glyphs for a folder's custom icon.
 *
 * unplugin-icons compiles `~icons/solar/*` into inline SVG components at BUILD
 * time, so the app can't render an arbitrary runtime icon name (no equivalent
 * of Eagle's open-ended icon library). Instead we pre-import a fixed, curated
 * set of Solar "Linear" glyphs and store only a short string KEY on the folder;
 * `resolveFolderIcon` maps that key back to a component.
 *
 * This is the one deliberate exception to the "icons only via `components/icons`"
 * gateway (see icons.ts): a catalog is an icon-definition module, not a
 * component, and keeping the ~50 picker glyphs here avoids bloating the semantic
 * registry. Every glyph is Linear to stay consistent with the app-wide default.
 */

import type { IconComponent } from "@/components/icons";
import IconAlbum from "~icons/solar/album-linear";
import IconAtom from "~icons/solar/atom-linear";
import IconBag from "~icons/solar/bag-linear";
import IconBell from "~icons/solar/bell-linear";
import IconBookmark from "~icons/solar/bookmark-linear";
import IconBox from "~icons/solar/box-linear";
import IconBuildings from "~icons/solar/buildings-linear";
import IconCalendar from "~icons/solar/calendar-linear";
import IconCamera from "~icons/solar/camera-linear";
import IconCart from "~icons/solar/cart-large-linear";
import IconCase from "~icons/solar/case-linear";
import IconChart from "~icons/solar/chart-linear";
import IconChecklist from "~icons/solar/checklist-linear";
import IconClapperboard from "~icons/solar/clapperboard-linear";
import IconClock from "~icons/solar/clock-circle-linear";
import IconCodeSquare from "~icons/solar/code-square-linear";
import IconCpu from "~icons/solar/cpu-linear";
import IconCrown from "~icons/solar/crown-linear";
import IconCup from "~icons/solar/cup-linear";
import IconDocument from "~icons/solar/document-text-linear";
import IconFire from "~icons/solar/fire-linear";
import IconFlag from "~icons/solar/flag-linear";
import IconFolderFav from "~icons/solar/folder-favourite-star-linear";
import IconFolderPlain from "~icons/solar/folder-linear";
import IconFolderOpen from "~icons/solar/folder-open-linear";
import IconFolderFiles from "~icons/solar/folder-with-files-linear";
import IconGallery from "~icons/solar/gallery-linear";
import IconGift from "~icons/solar/gift-linear";
import IconGraph from "~icons/solar/graph-linear";
import IconHeart from "~icons/solar/heart-linear";
import IconHome from "~icons/solar/home-2-linear";
import IconKey from "~icons/solar/key-linear";
import IconLaptop from "~icons/solar/laptop-linear";
import IconLeaf from "~icons/solar/leaf-linear";
import IconLock from "~icons/solar/lock-linear";
import IconMagic from "~icons/solar/magic-stick-3-linear";
import IconMapPoint from "~icons/solar/map-point-linear";
import IconMedal from "~icons/solar/medal-star-linear";
import IconMonitor from "~icons/solar/monitor-linear";
import IconMusic from "~icons/solar/music-note-2-linear";
import IconNotebook from "~icons/solar/notebook-linear";
import IconPaintRoller from "~icons/solar/paint-roller-linear";
import IconPalette from "~icons/solar/palette-linear";
import IconPen from "~icons/solar/pen-linear";
import IconPlanet from "~icons/solar/planet-linear";
import IconRocket from "~icons/solar/rocket-linear";
import IconSettings from "~icons/solar/settings-linear";
import IconShield from "~icons/solar/shield-linear";
import IconSmartphone from "~icons/solar/smartphone-linear";
import IconStar from "~icons/solar/star-linear";
import IconTag from "~icons/solar/tag-linear";
import IconVideo from "~icons/solar/videocamera-linear";

/** Stable group ids — the picker resolves their labels via i18n. */
export type FolderIconGroupId =
	| "general"
	| "media"
	| "work"
	| "objects"
	| "symbols";

export type FolderIconGroup = {
	id: FolderIconGroupId;
	keys: readonly string[];
};

/**
 * Key → glyph. The KEY (e.g. `"star"`) is the stable value persisted on the
 * folder; never rename a key without a migration, or existing folders lose
 * their icon. Adding new glyphs is free.
 */
export const FOLDER_ICONS: Readonly<Record<string, IconComponent>> = {
	folder: IconFolderPlain,
	"folder-open": IconFolderOpen,
	"folder-files": IconFolderFiles,
	"folder-fav": IconFolderFav,
	star: IconStar,
	heart: IconHeart,
	bookmark: IconBookmark,
	flag: IconFlag,
	tag: IconTag,
	bell: IconBell,
	gallery: IconGallery,
	camera: IconCamera,
	video: IconVideo,
	music: IconMusic,
	palette: IconPalette,
	pen: IconPen,
	"paint-roller": IconPaintRoller,
	clapperboard: IconClapperboard,
	album: IconAlbum,
	document: IconDocument,
	notebook: IconNotebook,
	checklist: IconChecklist,
	calendar: IconCalendar,
	clock: IconClock,
	code: IconCodeSquare,
	case: IconCase,
	chart: IconChart,
	graph: IconGraph,
	box: IconBox,
	bag: IconBag,
	gift: IconGift,
	cup: IconCup,
	home: IconHome,
	buildings: IconBuildings,
	"map-point": IconMapPoint,
	rocket: IconRocket,
	cart: IconCart,
	monitor: IconMonitor,
	laptop: IconLaptop,
	smartphone: IconSmartphone,
	key: IconKey,
	lock: IconLock,
	shield: IconShield,
	settings: IconSettings,
	magic: IconMagic,
	crown: IconCrown,
	medal: IconMedal,
	cpu: IconCpu,
	atom: IconAtom,
	leaf: IconLeaf,
	planet: IconPlanet,
	fire: IconFire,
};

/** Picker layout: glyphs grouped by theme, in display order. */
export const FOLDER_ICON_GROUPS: readonly FolderIconGroup[] = [
	{
		id: "general",
		keys: [
			"folder",
			"folder-open",
			"folder-files",
			"folder-fav",
			"star",
			"heart",
			"bookmark",
			"flag",
			"tag",
			"bell",
		],
	},
	{
		id: "media",
		keys: [
			"gallery",
			"camera",
			"video",
			"music",
			"palette",
			"pen",
			"paint-roller",
			"clapperboard",
			"album",
		],
	},
	{
		id: "work",
		keys: [
			"document",
			"notebook",
			"checklist",
			"calendar",
			"clock",
			"code",
			"case",
			"chart",
			"graph",
		],
	},
	{
		id: "objects",
		keys: [
			"box",
			"bag",
			"gift",
			"cup",
			"home",
			"buildings",
			"map-point",
			"rocket",
			"cart",
			"monitor",
			"laptop",
			"smartphone",
		],
	},
	{
		id: "symbols",
		keys: [
			"key",
			"lock",
			"shield",
			"settings",
			"magic",
			"crown",
			"medal",
			"cpu",
			"atom",
			"leaf",
			"planet",
			"fire",
		],
	},
];

/** Component for a stored key, or `null` for the default folder glyph. */
export function resolveFolderIcon(
	key: string | null | undefined,
): IconComponent | null {
	if (!key) return null;
	return FOLDER_ICONS[key] ?? null;
}
