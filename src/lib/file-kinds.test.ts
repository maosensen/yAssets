import { describe, expect, it } from "vitest";
import { extsForKinds, FILE_KINDS } from "./file-kinds";

describe("extsForKinds", () => {
	it("returns undefined for no selection", () => {
		expect(extsForKinds(undefined)).toBeUndefined();
		expect(extsForKinds([])).toBeUndefined();
	});

	it("expands a single kind to its extension list", () => {
		const image = FILE_KINDS.find((k) => k.key === "image");
		expect(extsForKinds(["image"])).toEqual(image?.exts);
		expect(extsForKinds(["image"])).toContain("png");
		expect(extsForKinds(["image"])).toContain("psd");
	});

	it("unions multiple kinds", () => {
		const union = extsForKinds(["image", "pdf"]);
		expect(union).toContain("png");
		expect(union).toContain("pdf");
	});

	it("ignores unknown keys, returning undefined when nothing resolves", () => {
		expect(extsForKinds(["bogus"])).toBeUndefined();
		expect(extsForKinds(["bogus", "pdf"])).toEqual(["pdf"]);
	});
});
