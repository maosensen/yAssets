import { beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_ROW_HEIGHT,
	MAX_ROW_HEIGHT,
	MIN_ROW_HEIGHT,
	useViewPrefsStore,
} from "./view-prefs-store";

describe("view-prefs-store", () => {
	beforeEach(() => {
		localStorage.clear();
		useViewPrefsStore.setState({
			targetRowHeight: DEFAULT_ROW_HEIGHT,
			sort: "ImportedAt",
			dir: "Desc",
		});
	});

	it("clamps targetRowHeight into the slider range", () => {
		useViewPrefsStore.getState().setTargetRowHeight(10);
		expect(useViewPrefsStore.getState().targetRowHeight).toBe(MIN_ROW_HEIGHT);
		useViewPrefsStore.getState().setTargetRowHeight(9999);
		expect(useViewPrefsStore.getState().targetRowHeight).toBe(MAX_ROW_HEIGHT);
		useViewPrefsStore.getState().setTargetRowHeight(200.6);
		expect(useViewPrefsStore.getState().targetRowHeight).toBe(201);
	});

	it("stores sort key and direction", () => {
		useViewPrefsStore.getState().setSort("Name", "Asc");
		expect(useViewPrefsStore.getState().sort).toBe("Name");
		expect(useViewPrefsStore.getState().dir).toBe("Asc");
	});

	it("persists to localStorage under a stable key", () => {
		useViewPrefsStore.getState().setTargetRowHeight(240);
		const raw = localStorage.getItem("yassets-view-prefs");
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw ?? "{}").state.targetRowHeight).toBe(240);
	});
});
