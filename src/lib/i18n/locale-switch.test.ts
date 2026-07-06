import { afterEach, expect, test } from "vitest";
import { getLocale, localeCodes, setLocale, T } from "./index";

// Runtime tests for the T proxy resolving against the active locale. Structural
// completeness (every locale has every key) is already guaranteed at compile
// time by `Messages`, so these focus on the switch actually taking effect.

afterEach(() => setLocale("en"));

test("ships English, Chinese and Japanese", () => {
	expect([...localeCodes].sort()).toEqual(["en", "ja", "zh"]);
});

test("T resolves against the active locale, live", () => {
	setLocale("en");
	expect(T.common.cancel).toBe("Cancel");
	expect(getLocale()).toBe("en");

	setLocale("zh");
	expect(getLocale()).toBe("zh");
	expect(T.common.cancel).not.toBe("Cancel");

	setLocale("ja");
	expect(getLocale()).toBe("ja");
	expect(T.common.cancel).not.toBe("Cancel");
});

test("interpolation functions keep working after a switch", () => {
	setLocale("zh");
	// Same arity as English; returns a non-empty localized string.
	expect(T.inspector.starLabel(3)).toBeTruthy();
	expect(T.preview.counter(2, 5)).toContain("2");
	expect(T.trashUi.confirmDeleteDesc(1)).toBeTruthy();
	expect(T.trashUi.confirmDeleteDesc(3)).toBeTruthy();
});
