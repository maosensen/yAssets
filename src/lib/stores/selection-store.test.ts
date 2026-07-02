import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "./selection-store";

describe("selection-store", () => {
	beforeEach(() => {
		useSelectionStore.getState().clear();
	});

	it("selectOnly replaces the selection and sets the anchor", () => {
		useSelectionStore.getState().selectOnly("a");
		useSelectionStore.getState().selectOnly("b");
		const state = useSelectionStore.getState();
		expect([...state.selectedIds]).toEqual(["b"]);
		expect(state.anchorId).toBe("b");
	});

	it("toggle adds and removes ids", () => {
		useSelectionStore.getState().toggle("a");
		useSelectionStore.getState().toggle("b");
		expect(useSelectionStore.getState().selectedIds.size).toBe(2);
		useSelectionStore.getState().toggle("a");
		expect([...useSelectionStore.getState().selectedIds]).toEqual(["b"]);
	});

	it("clear empties everything", () => {
		useSelectionStore.getState().selectOnly("a");
		useSelectionStore.getState().clear();
		const state = useSelectionStore.getState();
		expect(state.selectedIds.size).toBe(0);
		expect(state.anchorId).toBeNull();
	});
});
