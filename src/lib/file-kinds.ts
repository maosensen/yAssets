/**
 * File-KIND facet for the filter panel. The URL/query carries compact kind keys
 * (image/video/…); the backend filters by extension, so kinds expand to their
 * extension union here — one place, shared by the filter UI and the query layer.
 */

export type FileKind = {
	key: string;
	label: string;
	exts: string[];
};

export const FILE_KINDS: FileKind[] = [
	{
		key: "image",
		label: "Images",
		exts: [
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
			"psd",
			"psb",
			"sketch",
			"ora",
			"kra",
		],
	},
	{ key: "video", label: "Videos", exts: ["mp4", "mov", "m4v", "webm"] },
	{
		key: "audio",
		label: "Audio",
		exts: ["mp3", "m4a", "aac", "wav", "flac", "aiff"],
	},
	{ key: "pdf", label: "PDF", exts: ["pdf"] },
	{
		key: "doc",
		label: "Documents",
		exts: ["md", "markdown", "mdx", "txt", "rtf", "doc", "docx", "csv"],
	},
];

const EXTS_BY_KIND = new Map(FILE_KINDS.map((kind) => [kind.key, kind.exts]));

/** Expand selected kind keys to the union of their extensions (for the backend
 *  `types` facet). Returns undefined when nothing is selected. */
export function extsForKinds(
	kinds: string[] | undefined,
): string[] | undefined {
	if (!kinds || kinds.length === 0) return undefined;
	const exts = kinds.flatMap((key) => EXTS_BY_KIND.get(key) ?? []);
	return exts.length > 0 ? exts : undefined;
}
