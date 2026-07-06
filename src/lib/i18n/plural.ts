/**
 * Regular-noun pluralizer backed by Intl.PluralRules. Locale-aware selection of
 * the singular vs plural form; the surface word is still built by suffixing "s"
 * for regular English nouns, with an explicit override for irregulars.
 *
 *   counted(1, "item")            → "1 item"
 *   counted(3, "item")            → "3 items"
 *   counted(2, "child", "children") → "2 children"
 *
 * Kept tiny and pure so it unit-tests without a DOM and can back any locale's
 * copy (a future non-English locale swaps the PluralRules tag).
 */

const cardinal = new Intl.PluralRules("en-US");

export function counted(n: number, singular: string, plural?: string): string {
	const word =
		cardinal.select(n) === "one" ? singular : (plural ?? `${singular}s`);
	return `${n} ${word}`;
}
