/**
 * URL construction for the `yasset://` media protocol — the single point the
 * grid/inspector/preview use to reference library media by id.
 *
 * `convertFileSrc` handles the platform URL shape (macOS/Linux
 * `yasset://localhost/<path>`, Windows `http://yasset.localhost/<path>`) and
 * percent-encodes the path; the Rust handler decodes before routing.
 * The frontend never sees absolute filesystem paths.
 */

import { convertFileSrc } from "@tauri-apps/api/core";

/** 512px-long-edge WebP thumbnail. Hot path — zero DB lookups in Rust. */
export function thumbUrl(assetId: string): string {
	return convertFileSrc(`thumb/${assetId}`, "yasset");
}

/** Original file (detail / preview). Served with the stored mime type. */
export function fileUrl(assetId: string): string {
	return convertFileSrc(`file/${assetId}`, "yasset");
}
