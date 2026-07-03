/**
 * Preview viewer dispatch — maps an asset (ext + mime + thumb state) to the
 * viewer component kind the preview route renders. Adding a format = extend
 * a set here + add a case in `PreviewBody` (routes/_library/preview.tsx).
 *
 * Order matters: specific kinds win over the generic text sniff, and `image`
 * requires actual dimensions (the pan/zoom canvas needs a coordinate system).
 */

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
	| "markdown"
	| "text"
	| "fallback";

/**
 * Formats WebKit/WebView2 play natively via <video>. Mirrored by the SQL in
 * `list_video_thumb_candidates` (src-tauri/src/commands/assets.rs).
 */
export const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "webm"]);

/** Formats WebKit/WebView2 decode natively via <audio>. */
const AUDIO_EXTS = new Set(["mp3", "m4a", "aac", "wav", "flac", "aiff"]);

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
	"html",
	"htm",
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
	// Video/PDF win over the thumb check — captured covers set has_thumb,
	// and those must keep their own viewers, not the image canvas.
	if (VIDEO_EXTS.has(ext)) return "video";
	if (ext === "pdf") return "pdf";
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
