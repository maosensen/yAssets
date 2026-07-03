import { expect, test } from "vitest";
import { viewerKindFor } from "./viewer-registry";

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

test("audio, markdown and text map by extension (case-insensitive)", () => {
	expect(viewerKindFor({ ...base, ext: "mp3" })).toBe("audio");
	expect(viewerKindFor({ ...base, ext: "FLAC".toLowerCase() })).toBe("audio");
	expect(viewerKindFor({ ...base, ext: "MD".toLowerCase() })).toBe("markdown");
	expect(viewerKindFor({ ...base, ext: "rs" })).toBe("text");
	expect(viewerKindFor({ ...base, ext: "json" })).toBe("text");
});

test("unknown extensions fall back — unless the mime says text", () => {
	expect(viewerKindFor({ ...base, ext: "blend" })).toBe("fallback");
	expect(
		viewerKindFor({ ...base, ext: "unknownext", mime: "text/x-custom" }),
	).toBe("text");
	expect(viewerKindFor({ ...base, ext: "" })).toBe("fallback");
});
