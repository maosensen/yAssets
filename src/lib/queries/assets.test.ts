import { describe, expect, it } from "vitest";
import type { AssetScope } from "@/lib/bindings";
import { assetListQueryOptions } from "./assets";

const base = { sort: "ImportedAt" as const, dir: "Desc" as const };
const keyFor = (scope: AssetScope) =>
	JSON.stringify(assetListQueryOptions({ scope, ...base }).queryKey);

describe("assetListQueryOptions query keys", () => {
	// Regression: color hue and smart-folder id used to fall through to a
	// discriminator-less key, so every hue / every smart folder collided on one
	// cache entry and showed whichever loaded first/last.
	it("gives each color hue its own key", () => {
		expect(keyFor({ kind: "color", hue: 5 })).not.toBe(
			keyFor({ kind: "color", hue: 9 }),
		);
	});

	it("gives each smart folder its own key", () => {
		expect(keyFor({ kind: "smart_folder", smart_folder_id: "a" })).not.toBe(
			keyFor({ kind: "smart_folder", smart_folder_id: "b" }),
		);
	});

	it("still distinguishes folders and tags", () => {
		expect(keyFor({ kind: "folder", folder_id: "x" })).not.toBe(
			keyFor({ kind: "folder", folder_id: "y" }),
		);
		expect(keyFor({ kind: "tag", tag_id: "x" })).not.toBe(
			keyFor({ kind: "tag", tag_id: "y" }),
		);
	});
});
