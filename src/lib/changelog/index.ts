/**
 * User-facing changelog — a curated, translated "What's New" history, distinct
 * from the developer CHANGELOG.md (which tracks every change for the GitHub
 * release notes). Entries here are hand-picked highlights, categorized and in
 * friendly wording, newest first, localized per UI language.
 *
 * Keep this in sync on release: add one entry per shipped version in all three
 * locale files (see the release runbook). Every release needs a headline
 * `title` (plus an optional `summary`), and each change a short row `title`.
 */

import { getLocale } from "@/lib/text";
import { en } from "./en";
import { ja } from "./ja";
import { zh } from "./zh";

/** Change category — drives the colored tag in the dialog. `kind` is
 *  language-independent, so it stays identical across the locale files. */
export type ChangeKind = "new" | "improved" | "fixed";

export type ChangelogChange = {
	kind: ChangeKind;
	/** One-sentence description of the change. */
	text: string;
	/** Short feature name shown as the row heading (e.g. "AI icon generation"). */
	title?: string;
};

export type ChangelogRelease = {
	version: string;
	/** ISO date (YYYY-MM-DD). */
	date: string;
	/** Curated, user-facing changes for this release. */
	changes: ChangelogChange[];
	/** Release headline (e.g. "yAssets 0.1 — a local-first library"). */
	title: string;
	/** Optional one-paragraph framing shown under the headline. */
	summary?: string;
};

const byLocale = { en, zh, ja };

/** Changelog for the active UI locale (falls back to English). */
export function getChangelog(): ChangelogRelease[] {
	return byLocale[getLocale()] ?? en;
}
