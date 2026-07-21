/**
 * Pure folder-tree helpers: flat rows (backend order = position, name) →
 * nested tree, plus name filtering that keeps ancestor chains visible.
 */

import type { Folder } from "@/lib/bindings";
import type { FolderDropZone } from "@/lib/stores/folder-drag-store";

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

/** A folder plus all of its descendants — the set that can't receive itself. */
export function collectSubtreeIds(node: FolderNode): Set<string> {
	const ids = new Set<string>();
	const visit = (n: FolderNode) => {
		ids.add(n.id);
		for (const child of n.children) visit(child);
	};
	visit(node);
	return ids;
}

/**
 * Resolve a drag drop (a hovered row + zone) into the `reorder_folder` args
 * `{ newParentId, index }`, where `index` is over the target parent's children
 * EXCLUDING the dragged folder — matching the backend. Returns null when the
 * drop is invalid (onto itself / into its own subtree) or a no-op (same slot).
 *
 * `rows` must be the flat folder list in display order (position, name), i.e.
 * exactly what `list_folders` returns, so sibling order is preserved by filter.
 */
export function resolveFolderDrop(
	rows: readonly Pick<Folder, "id" | "parent_id">[],
	draggingId: string,
	target: { folderId: string; zone: FolderDropZone },
): { newParentId: string | null; index: number } | null {
	if (target.folderId === draggingId) return null;

	const parentOf = new Map<string, string | null>();
	for (const row of rows) parentOf.set(row.id, row.parent_id);

	// A drop is illegal if the target sits inside the dragged folder's subtree.
	let cursor: string | null | undefined = target.folderId;
	while (cursor != null) {
		if (cursor === draggingId) return null;
		cursor = parentOf.get(cursor) ?? null;
	}

	const orderedChildren = (parent: string | null): string[] =>
		rows.filter((row) => row.parent_id === parent).map((row) => row.id);

	let newParentId: string | null;
	let index: number;
	if (target.zone === "into") {
		newParentId = target.folderId;
		index = orderedChildren(newParentId).filter(
			(id) => id !== draggingId,
		).length;
	} else {
		newParentId = parentOf.get(target.folderId) ?? null;
		const siblings = orderedChildren(newParentId).filter(
			(id) => id !== draggingId,
		);
		const targetIndex = siblings.indexOf(target.folderId);
		if (targetIndex === -1) return null;
		index = target.zone === "before" ? targetIndex : targetIndex + 1;
	}

	// No-op: same parent, and the dragged folder already sits in that slot.
	const currentParent = parentOf.get(draggingId) ?? null;
	if (newParentId === currentParent) {
		const origIndex = orderedChildren(currentParent).indexOf(draggingId);
		if (index === origIndex) return null;
	}
	return { newParentId, index };
}
