/**
 * User-facing changelog — a curated, translated "What's New" history, distinct
 * from the developer CHANGELOG.md (which tracks every change for the GitHub
 * release notes). Entries here are hand-picked highlights, friendly wording,
 * newest first, and localized per UI language.
 *
 * Keep this in sync on release: add one entry per shipped version in all three
 * locale files (see the release runbook).
 */

import { getLocale } from "@/lib/text";
import { en } from "./en";
import { ja } from "./ja";
import { zh } from "./zh";

export type ChangelogRelease = {
	version: string;
	/** ISO date (YYYY-MM-DD). */
	date: string;
	/** Curated, user-facing highlights — newest-first at the file level. */
	highlights: string[];
};

const byLocale = { en, zh, ja };

/** Changelog for the active UI locale (falls back to English). */
export function getChangelog(): ChangelogRelease[] {
	return byLocale[getLocale()] ?? en;
}
