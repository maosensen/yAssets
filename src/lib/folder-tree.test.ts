import { describe, expect, it } from "vitest";
import type { Folder } from "@/lib/bindings";
import {
	buildFolderTree,
	filterFolderTree,
	flattenFolderTree,
	flattenVisibleFolders,
} from "./folder-tree";

function row(id: string, parent: string | null, name: string): Folder {
	return {
		id,
		parent_id: parent,
		name,
		position: 0,
		asset_count: 0,
		created_at: 0,
		description: null,
		color: null,
		icon: null,
	};
}

describe("buildFolderTree", () => {
	it("nests children under parents, preserving input order", () => {
		const tree = buildFolderTree([
			row("a", null, "A"),
			row("b", "a", "B"),
			row("c", "b", "C"),
			row("d", null, "D"),
		]);
		expect(tree.map((n) => n.id)).toEqual(["a", "d"]);
		expect(tree[0]?.children[0]?.id).toBe("b");
		expect(tree[0]?.children[0]?.children[0]?.id).toBe("c");
	});

	it("handles out-of-order rows (child before parent)", () => {
		const tree = buildFolderTree([row("b", "a", "B"), row("a", null, "A")]);
		expect(tree).toHaveLength(1);
		expect(tree[0]?.children[0]?.id).toBe("b");
	});

	it("treats orphans (missing parent) as roots", () => {
		const tree = buildFolderTree([row("x", "ghost", "X")]);
		expect(tree.map((n) => n.id)).toEqual(["x"]);
	});
});

describe("filterFolderTree", () => {
	const tree = buildFolderTree([
		row("a", null, "Design"),
		row("b", "a", "Logos"),
		row("c", "a", "Icons"),
		row("d", null, "Photos"),
	]);

	it("returns everything for a blank term", () => {
		expect(filterFolderTree(tree, "  ")).toHaveLength(2);
	});

	it("keeps ancestors of a matching descendant", () => {
		const filtered = filterFolderTree(tree, "logo");
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.id).toBe("a");
		expect(filtered[0]?.children.map((c) => c.id)).toEqual(["b"]);
	});

	it("matches case-insensitively and drops unrelated branches", () => {
		const filtered = filterFolderTree(tree, "PHOTOS");
		expect(filtered.map((n) => n.id)).toEqual(["d"]);
	});

	it("keeps a matching parent even when no child matches", () => {
		const filtered = filterFolderTree(tree, "design");
		expect(filtered[0]?.id).toBe("a");
		expect(filtered[0]?.children).toHaveLength(0);
	});
});

describe("flattenFolderTree", () => {
	it("flattens depth-first with depths", () => {
		const tree = buildFolderTree([
			row("a", null, "A"),
			row("b", "a", "B"),
			row("c", null, "C"),
		]);
		const flat = flattenFolderTree(tree).map(({ node, depth }) => [
			node.id,
			depth,
		]);
		expect(flat).toEqual([
			["a", 0],
			["b", 1],
			["c", 0],
		]);
	});
});

describe("flattenVisibleFolders", () => {
	const tree = buildFolderTree([
		row("a", null, "A"),
		row("b", "a", "B"),
		row("c", "b", "C"),
		row("d", null, "D"),
	]);

	it("hides collapsed children (empty expanded set)", () => {
		const flat = flattenVisibleFolders(tree, new Set(), false).map(
			({ node }) => node.id,
		);
		expect(flat).toEqual(["a", "d"]);
	});

	it("reveals only the expanded branch, one level at a time", () => {
		const flat = flattenVisibleFolders(tree, new Set(["a"]), false).map(
			({ node, depth }) => [node.id, depth],
		);
		// "a" expanded shows "b"; "b" is still collapsed so "c" stays hidden.
		expect(flat).toEqual([
			["a", 0],
			["b", 1],
			["d", 0],
		]);
	});

	it("reveals a deep chain when every ancestor is expanded", () => {
		const flat = flattenVisibleFolders(tree, new Set(["a", "b"]), false).map(
			({ node }) => node.id,
		);
		expect(flat).toEqual(["a", "b", "c", "d"]);
	});

	it("showAll ignores the expanded set and returns the full tree", () => {
		const flat = flattenVisibleFolders(tree, new Set(), true).map(
			({ node, depth }) => [node.id, depth],
		);
		expect(flat).toEqual([
			["a", 0],
			["b", 1],
			["c", 2],
			["d", 0],
		]);
	});

	it("matches flattenFolderTree when showAll is true", () => {
		expect(flattenVisibleFolders(tree, new Set(), true)).toEqual(
			flattenFolderTree(tree),
		);
	});
});
