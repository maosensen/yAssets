import { describe, expect, it } from "vitest";
import { counted } from "./plural";

describe("counted", () => {
	it("uses the singular only for exactly one", () => {
		expect(counted(1, "item")).toBe("1 item");
		expect(counted(0, "item")).toBe("0 items");
		expect(counted(2, "item")).toBe("2 items");
		expect(counted(42, "item")).toBe("42 items");
	});

	it("suffixes 's' by default, preserving multi-word nouns", () => {
		expect(counted(3, "orphan file")).toBe("3 orphan files");
		expect(counted(1, "orphan file")).toBe("1 orphan file");
	});

	it("honors an explicit plural for irregular nouns", () => {
		expect(counted(2, "child", "children")).toBe("2 children");
		expect(counted(1, "child", "children")).toBe("1 child");
	});
});
