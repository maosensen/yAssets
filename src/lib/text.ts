/**
 * Copy barrel. `T` is the single accessor every component imports for
 * user-facing strings — kept at this stable path so the ~43 call sites don't
 * churn. The strings themselves live in the i18n layer, keyed by domain, in
 * `src/lib/i18n/en.ts`; `T` resolves them for the active locale.
 */

export {
	getLocale,
	type LocaleCode,
	localeCodes,
	type Messages,
	setLocale,
	T,
} from "./i18n";
