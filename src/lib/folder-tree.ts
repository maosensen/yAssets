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
	/** Hex color tinting the folder glyph; null = default neutral. */
	color: string | null;
	/** Key into the folder-icon catalog; null = default folder glyph. */
	icon: string | null;
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
			color: row.color,
			icon: row.icon,
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

export type FlatFolderRow = { node: FolderNode; depth: number };

/**
 * Depth-first rows with depth. A node's children are included only when
 * `showAll` is true (flat listing) OR the node's id is in `expanded` — the
 * shape a collapsible tree picker needs. `flattenFolderTree` is the
 * `showAll` special case.
 */
export function flattenVisibleFolders(
	roots: readonly FolderNode[],
	expanded: ReadonlySet<string>,
	showAll: boolean,
): FlatFolderRow[] {
	const out: FlatFolderRow[] = [];
	const visit = (node: FolderNode, depth: number) => {
		out.push({ node, depth });
		if (node.children.length > 0 && (showAll || expanded.has(node.id))) {
			for (const child of node.children) visit(child, depth + 1);
		}
	};
	for (const root of roots) visit(root, 0);
	return out;
}

const NO_EXPANDED: ReadonlySet<string> = new Set();

/** Depth-first flatten with depth — for indented flat pickers (menus). */
export function flattenFolderTree(
	roots: readonly FolderNode[],
): FlatFolderRow[] {
	return flattenVisibleFolders(roots, NO_EXPANDED, true);
}
