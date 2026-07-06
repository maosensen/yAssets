/**
 * UI language selection — the active locale for the `T` copy accessor.
 *
 * Persisted to localStorage (synchronous hydration, no flash; same precedent as
 * the theme provider and view-prefs store). The zustand state drives an
 * `I18nProvider` remount so every component re-reads `T` on a switch; the
 * store's action also pushes the choice into the i18n runtime (`setLocale`) so
 * the proxy resolves the new locale.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	setLocale as applyLocale,
	type LocaleCode,
	localeCodes,
} from "@/lib/i18n";

/** First launch (nothing persisted): fall back to the system language if we
 *  ship it, else English. `navigator.language` is e.g. "zh-CN" / "ja" / "en-US";
 *  our codes are the bare language subtags. */
function systemLocale(): LocaleCode {
	const prefix = navigator.language.toLowerCase().split("-")[0];
	return localeCodes.find((code) => code === prefix) ?? "en";
}

type LocaleState = {
	locale: LocaleCode;
	setLocale: (code: LocaleCode) => void;
};

export const useLocaleStore = create<LocaleState>()(
	persist(
		(set) => ({
			locale: systemLocale(),
			setLocale: (code) => {
				applyLocale(code); // update the T proxy BEFORE the remount renders
				set({ locale: code });
			},
		}),
		{
			name: "yassets-locale",
			// Keep the runtime in lockstep with a persisted value right after
			// hydration, before React first renders.
			onRehydrateStorage: () => (state) => {
				if (state) applyLocale(state.locale);
			},
		},
	),
);

// Belt-and-suspenders: sync the runtime to the store's current locale at import
// time (covers the first-launch case where nothing was persisted, so
// onRehydrateStorage has no stored value to apply).
applyLocale(useLocaleStore.getState().locale);
