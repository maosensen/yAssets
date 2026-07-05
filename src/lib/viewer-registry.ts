/**
 * Ext dispatch registry — maps an asset (ext + mime + thumb state) to both the
 * preview viewer kind (`viewerKindFor`) and the grid card's fallback glyph
 * (`iconForExt`). Adding a format = extend a set here + add a case in
 * `PreviewBody` (routes/_library/preview.tsx).
 *
 * Order matters: specific kinds win over the generic text sniff, and `image`
 * requires actual dimensions (the pan/zoom canvas needs a coordinate system).
 */

import {
	IconArchive,
	IconCode,
	type IconComponent,
	IconFile,
	IconFileText,
	IconImageFile,
	IconMusic,
	IconPdf,
	IconVideo,
} from "@/components/icons";

type ViewerAsset = {
	ext: string;
	/** Optional — AssetSummary (grid list) doesn't carry mime; detail does. */
	mime?: string | null;
	has_thumb: boolean;
	width: number | null;
	height: number | null;
};

export type ViewerKind =
	| "image"
	| "video"
	| "audio"
	| "pdf"
	| "html"
	| "markdown"
	| "text"
	| "fallback";

/**
 * Formats WebKit/WebView2 play natively via <video>. Mirrored by the SQL in
 * `list_cover_candidates` (src-tauri/src/commands/assets.rs).
 */
export const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "webm"]);

/** Formats WebKit/WebView2 decode natively via <audio>. */
const AUDIO_EXTS = new Set(["mp3", "m4a", "aac", "wav", "flac", "aiff"]);

/**
 * HEIC/HEIF — no headless Rust decoder, so the cover is captured client-side.
 * WebKit (macOS WebView) decodes these in an <img>; Chromium WebView2 /
 * WebKitGTK do not, so on those engines capture fails and the card keeps its
 * type-icon placeholder.
 */
export const HEIC_EXTS = new Set(["heic", "heif"]);

/** Rendered as a document in a sandboxed iframe (not as source text). */
const HTML_EXTS = new Set(["html", "htm"]);

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdx"]);

/** Plain-text-ish formats worth rendering as text (code included). */
const TEXT_EXTS = new Set([
	"txt",
	"log",
	"json",
	"jsonc",
	"xml",
	"yaml",
	"yml",
	"toml",
	"ini",
	"cfg",
	"conf",
	"env",
	"csv",
	"tsv",
	"js",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"jsx",
	"css",
	"scss",
	"less",
	"svelte",
	"vue",
	"py",
	"rs",
	"go",
	"java",
	"kt",
	"swift",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"rb",
	"php",
	"sh",
	"zsh",
	"bash",
	"fish",
	"sql",
	"graphql",
	"proto",
	"diff",
	"patch",
]);

export function viewerKindFor(asset: ViewerAsset): ViewerKind {
	const ext = asset.ext.toLowerCase();
	// Video/PDF/HTML win over the thumb check — captured covers set has_thumb,
	// and those must keep their own viewers, not the image canvas.
	if (VIDEO_EXTS.has(ext)) return "video";
	if (ext === "pdf") return "pdf";
	if (HTML_EXTS.has(ext)) return "html";
	// Pan/zoom canvas needs real dimensions for its coordinate system.
	if (asset.has_thumb && asset.width != null && asset.height != null) {
		return "image";
	}
	if (AUDIO_EXTS.has(ext)) return "audio";
	if (MARKDOWN_EXTS.has(ext)) return "markdown";
	if (TEXT_EXTS.has(ext)) return "text";
	// Unknown extension but a text/* mime (recorded at import) still reads.
	if (asset.mime?.startsWith("text/")) return "text";
	return "fallback";
}

/** Image extensions (some are thumbnailed, some not) — for the fallback glyph. */
const IMAGE_EXTS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"svg",
	"ico",
	"avif",
	"tiff",
	"tif",
	"heic",
	"heif",
	// Design formats thumbnailed from their composite/embedded preview (Rust).
	"psd",
	"psb",
	"sketch",
	"ora",
	"kra",
]);

/**
 * Image exts the WebView decodes in an <img> across BOTH engines (WebKit +
 * Chromium). Formats outside this set (tiff/heic/psd/sketch) have a generated
 * thumbnail but an original the engine can't reliably decode — the preview
 * shows the thumbnail instead of fetching the (possibly huge) original.
 */
const NATIVE_IMAGE_EXTS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"svg",
	"ico",
]);

/** Whether the WebView can render this ext's original file directly in an <img>. */
export function canDecodeNativeImage(ext: string): boolean {
	return NATIVE_IMAGE_EXTS.has(ext.toLowerCase());
}

const ARCHIVE_EXTS = new Set([
	"zip",
	"rar",
	"7z",
	"tar",
	"gz",
	"tgz",
	"bz2",
	"xz",
	"zst",
]);

/** Programming-language subset of TEXT_EXTS — shown with a code glyph. */
const CODE_EXTS = new Set([
	"js",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"jsx",
	"css",
	"scss",
	"less",
	"svelte",
	"vue",
	"py",
	"rs",
	"go",
	"java",
	"kt",
	"swift",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"rb",
	"php",
	"sh",
	"zsh",
	"bash",
	"fish",
	"sql",
	"graphql",
	"proto",
]);

/**
 * The glyph a grid card shows when it has no thumbnail — a per-type icon
 * instead of raw extension text. Pure ext lookup (AssetSummary lacks mime).
 */
export function iconForExt(ext: string): IconComponent {
	const e = ext.toLowerCase();
	if (VIDEO_EXTS.has(e)) return IconVideo;
	if (AUDIO_EXTS.has(e)) return IconMusic;
	if (e === "pdf") return IconPdf;
	if (HTML_EXTS.has(e) || CODE_EXTS.has(e)) return IconCode;
	if (MARKDOWN_EXTS.has(e) || TEXT_EXTS.has(e)) return IconFileText;
	if (IMAGE_EXTS.has(e)) return IconImageFile;
	if (ARCHIVE_EXTS.has(e)) return IconArchive;
	return IconFile;
}
