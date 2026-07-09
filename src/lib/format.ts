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

/** `00:08` / `1:03:20` from milliseconds; `null` when unknown. `<= 0` counts
 *  as unknown — the worker stores 0 for videos whose length it can't probe. */
export function formatDuration(ms: number | null | undefined): string | null {
	if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
	const total = Math.round(ms / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const mm = String(minutes).padStart(2, "0");
	const ss = String(seconds).padStart(2, "0");
	return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Short, display-friendly host of a URL (drops a leading `www.`), for link
 * cards. Returns null for a missing/unparseable URL.
 */
export function hostLabel(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return null;
	}
}
