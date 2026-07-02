/** Display formatting helpers shared by grid captions and the inspector. */

import { format as formatDate } from "date-fns";

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	const units = ["KB", "MB", "GB", "TB"] as const;
	let value = bytes;
	let unit: string = "B";
	for (const next of units) {
		value /= 1024;
		unit = next;
		if (value < 1024) break;
	}
	return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

/** `1234 × 567` for images, `null` when dimensions are unknown. */
export function formatDimensions(
	width: number | null,
	height: number | null,
): string | null {
	if (width == null || height == null) return null;
	return `${width} × ${height}`;
}

export function formatDateTime(ms: number | null | undefined): string {
	if (ms == null) return "—";
	return formatDate(new Date(ms), "yyyy-MM-dd HH:mm");
}
