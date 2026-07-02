import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

describe("useDebouncedValue", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns the initial value immediately", () => {
		const { result } = renderHook(() => useDebouncedValue("a", 300));
		expect(result.current).toBe("a");
	});

	it("only settles after the delay, collapsing rapid changes", () => {
		const { result, rerender } = renderHook(
			({ value }) => useDebouncedValue(value, 300),
			{ initialProps: { value: "a" } },
		);

		rerender({ value: "ab" });
		act(() => {
			vi.advanceTimersByTime(200);
		});
		expect(result.current).toBe("a"); // not yet

		rerender({ value: "abc" }); // timer restarts
		act(() => {
			vi.advanceTimersByTime(200);
		});
		expect(result.current).toBe("a"); // still pending

		act(() => {
			vi.advanceTimersByTime(100);
		});
		expect(result.current).toBe("abc"); // settled on the latest
	});
});
