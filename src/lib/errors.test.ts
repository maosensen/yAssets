import { describe, expect, it } from "vitest";
import { describeError, isCommandError } from "./errors";
import { T } from "./text";

describe("isCommandError", () => {
	it("accepts objects with a string `code`", () => {
		expect(isCommandError({ code: "NotFound", detail: "x" })).toBe(true);
		expect(isCommandError({ code: "Internal" })).toBe(true);
	});

	it("rejects non-command values", () => {
		expect(isCommandError(new Error("boom"))).toBe(false);
		expect(isCommandError(null)).toBe(false);
		expect(isCommandError("nope")).toBe(false);
		expect(isCommandError({})).toBe(false);
		expect(isCommandError({ code: 42 })).toBe(false);
	});
});

describe("describeError", () => {
	it("maps a known code to its fixed copy (no detail appended)", () => {
		expect(describeError({ code: "NotFound", detail: "/x" })).toBe(
			T.errors.NotFound,
		);
		expect(describeError({ code: "NoLibraryOpen" })).toBe(
			T.errors.NoLibraryOpen,
		);
	});

	it("appends detail only for Conflict / LibraryIncompatible", () => {
		expect(describeError({ code: "Conflict", detail: "busy" })).toBe(
			T.errors.withDetail(T.errors.Conflict, "busy"),
		);
		expect(
			describeError({ code: "LibraryIncompatible", detail: "schema v9" }),
		).toBe(T.errors.withDetail(T.errors.LibraryIncompatible, "schema v9"));
	});

	it("falls back to `unknown` copy for an unrecognized code", () => {
		expect(describeError({ code: "Weird", detail: "x" })).toBe(
			T.errors.unknown,
		);
	});

	it("uses the Error message as detail on a plain Error", () => {
		expect(describeError(new Error("boom"))).toBe(
			T.errors.withDetail(T.errors.unknown, "boom"),
		);
	});

	it("returns `unknown` for wholly unknown throwables", () => {
		expect(describeError("plain string")).toBe(T.errors.unknown);
		expect(describeError({})).toBe(T.errors.unknown);
		expect(describeError(undefined)).toBe(T.errors.unknown);
	});
});
