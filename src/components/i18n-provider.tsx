import { Fragment, type ReactNode } from "react";
import { useLocaleStore } from "@/lib/stores/locale-store";

/**
 * Remounts its subtree whenever the active locale changes.
 *
 * `T` (see `@/lib/text`) is a proxy resolved at render time, so any component
 * that re-renders after a locale switch picks up the new strings for free — but
 * a plain context/state update would be blocked by `React.memo` on pure
 * components showing static labels. Keying a Fragment on the locale forces a
 * full remount of the subtree, so every component re-runs and re-reads `T`.
 * Language switching is a rare, deliberate action, so the cost (transient UI
 * state like grid scroll position) is acceptable; external stores (selection,
 * view-prefs) and the React Query cache live outside this subtree and survive.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
	const locale = useLocaleStore((state) => state.locale);
	return <Fragment key={locale}>{children}</Fragment>;
}
