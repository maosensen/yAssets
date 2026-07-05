import { expect, test } from "vitest";
import { iconForExt, viewerKindFor } from "./viewer-registry";

const base = {
	ext: "",
	mime: null as string | null,
	has_thumb: false,
	width: null as number | null,
	height: null as number | null,
};

test("thumbnailed assets with dimensions are images", () => {
	expect(
		viewerKindFor({
			...base,
			ext: "png",
			has_thumb: true,
			width: 800,
			height: 600,
		}),
	).toBe("image");
	// SVG thumbnails ride the same canvas.
	expect(
		viewerKindFor({
			...base,
			ext: "svg",
			has_thumb: true,
			width: 200,
			height: 100,
		}),
	).toBe("image");
});

test("a thumb without dimensions cannot drive the canvas", () => {
	expect(viewerKindFor({ ...base, ext: "png", has_thumb: true })).toBe(
		"fallback",
	);
});

test("video maps by extension and beats the thumb check once covered", () => {
	expect(viewerKindFor({ ...base, ext: "mp4" })).toBe("video");
	// A captured cover sets has_thumb + dimensions — still a video.
	expect(
		viewerKindFor({
			...base,
			ext: "mov",
			has_thumb: true,
			width: 1920,
			height: 1080,
		}),
	).toBe("video");
});

test("audio, markdown and text map by extension (case-insensitive)", () => {
	expect(viewerKindFor({ ...base, ext: "mp3" })).toBe("audio");
	expect(viewerKindFor({ ...base, ext: "FLAC".toLowerCase() })).toBe("audio");
	expect(viewerKindFor({ ...base, ext: "MD".toLowerCase() })).toBe("markdown");
	expect(viewerKindFor({ ...base, ext: "rs" })).toBe("text");
	expect(viewerKindFor({ ...base, ext: "json" })).toBe("text");
});

test("pdf maps to the inline pdf viewer", () => {
	expect(viewerKindFor({ ...base, ext: "pdf" })).toBe("pdf");
	expect(
		viewerKindFor({
			...base,
			ext: "pdf",
			has_thumb: true,
			width: 600,
			height: 800,
		}),
	).toBe("pdf");
});

test("html renders as a document, not as source text", () => {
	expect(viewerKindFor({ ...base, ext: "html" })).toBe("html");
	expect(viewerKindFor({ ...base, ext: "HTM".toLowerCase() })).toBe("html");
});

test("unknown extensions fall back — unless the mime says text", () => {
	expect(viewerKindFor({ ...base, ext: "blend" })).toBe("fallback");
	expect(
		viewerKindFor({ ...base, ext: "unknownext", mime: "text/x-custom" }),
	).toBe("text");
	expect(viewerKindFor({ ...base, ext: "" })).toBe("fallback");
});

test("iconForExt picks a per-type glyph by category", () => {
	// Same category → same component instance (identity check).
	expect(iconForExt("mp4")).toBe(iconForExt("mov"));
	expect(iconForExt("mp3")).toBe(iconForExt("flac"));
	expect(iconForExt("ts")).toBe(iconForExt("html"));
	// Distinct categories → distinct glyphs.
	expect(iconForExt("mp4")).not.toBe(iconForExt("mp3"));
	expect(iconForExt("pdf")).not.toBe(iconForExt("zip"));
	// Unknown extension → generic file glyph, distinct from typed ones.
	expect(iconForExt("xyzzy")).not.toBe(iconForExt("mp4"));
});
