/**
 * Pure folder-tree helpers: flat rows (backend order = position, name) →
 * nested tree, plus name filtering that keeps ancestor chains visible.
 */

import type { Folder } from "@/lib/bindings";

export type FolderNode = {
	id: string;
	parentId: string | null;
	name: string;
	assetCount: number;
	children: FolderNode[];
};

/** Orphan-tolerant: a row whose parent is missing becomes a root. */
export function buildFolderTree(rows: readonly Folder[]): FolderNode[] {
	const nodes = new Map<string, FolderNode>();
	for (const row of rows) {
		nodes.set(row.id, {
			id: row.id,
			parentId: row.parent_id,
			name: row.name,
			assetCount: row.asset_count,
			children: [],
		});
	}
	const roots: FolderNode[] = [];
	for (const row of rows) {
		const node = nodes.get(row.id);
		if (!node) continue;
		const parent = node.parentId ? nodes.get(node.parentId) : undefined;
		if (parent && parent !== node) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}
	return roots;
}

/**
 * Keep nodes whose name matches `term` (case-insensitive) — plus every
 * ancestor of a match, so the hit stays reachable in the tree.
 */
export function filterFolderTree(
	roots: readonly FolderNode[],
	term: string,
): FolderNode[] {
	const query = term.trim().toLowerCase();
	if (!query) return [...roots];

	const walk = (node: FolderNode): FolderNode | null => {
		const children = node.children
			.map(walk)
			.filter((child): child is FolderNode => child !== null);
		if (node.name.toLowerCase().includes(query) || children.length > 0) {
			return { ...node, children };
		}
		return null;
	};
	return roots.map(walk).filter((node): node is FolderNode => node !== null);
}

/** Depth-first flatten with depth — for indented flat pickers (menus). */
export function flattenFolderTree(
	roots: readonly FolderNode[],
): Array<{ node: FolderNode; depth: number }> {
	const out: Array<{ node: FolderNode; depth: number }> = [];
	const visit = (node: FolderNode, depth: number) => {
		out.push({ node, depth });
		for (const child of node.children) visit(child, depth + 1);
	};
	for (const root of roots) visit(root, 0);
	return out;
}
