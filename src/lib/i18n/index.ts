/**
 * i18n runtime. `T` resolves copy for the *active* locale; the message shape of
 * the English catalog (`./en`) is the `Messages` contract every locale must
 * satisfy. English is the only locale today — this layer exists so adding one
 * is "clone en.ts, translate, register here", with no churn at the ~43 call
 * sites that read `T.group.key`.
 */

import { en } from "./en";
import { ja } from "./ja";
import { zh } from "./zh";

/** The structural contract for a locale catalog (derived from English). */
export type Messages = typeof en;

/** Registered locales. Add a translation by listing its `Messages`-typed
 *  catalog here. */
const locales = { en, zh, ja } satisfies Record<string, Messages>;

export type LocaleCode = keyof typeof locales;

/** All registered locale codes, in registration order. */
export const localeCodes = Object.keys(locales) as LocaleCode[];

let active: LocaleCode = "en";

/** Switch the active locale. Note: this does not re-render mounted React trees
 *  on its own — a future locale switcher should bump app-level state alongside
 *  it so components re-read `T`. */
export function setLocale(code: LocaleCode): void {
	active = code;
}

export function getLocale(): LocaleCode {
	return active;
}

/**
 * Copy accessor. A shallow proxy so each `T.<group>` read resolves against the
 * current locale at call time (not import time) — `setLocale()` therefore
 * affects all subsequent reads. The call shape (`T.group.key` /
 * `T.group.fn(...)`) is identical to a plain object, so consumers are unaware
 * of the indirection.
 */
export const T: Messages = new Proxy({} as Messages, {
	get(_target, prop) {
		return (locales[active] as Record<PropertyKey, unknown>)[prop];
	},
});
