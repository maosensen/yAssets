import { beforeEach, describe, expect, it } from "vitest";
import { useExampleStore } from "@/lib/stores/example-store";

describe("example-store", () => {
	beforeEach(() => {
		useExampleStore.getState().clear();
	});

	it("adds items with generated ids", () => {
		useExampleStore.getState().addItem("first");
		const { items } = useExampleStore.getState();
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ label: "first" });
		expect(items[0].id).toBeTruthy();
	});

	it("removes an item by id", () => {
		const store = useExampleStore.getState();
		store.addItem("a");
		store.addItem("b");
		const [first] = useExampleStore.getState().items;
		useExampleStore.getState().removeItem(first.id);
		const labels = useExampleStore.getState().items.map((item) => item.label);
		expect(labels).toEqual(["b"]);
	});

	it("clears all items", () => {
		useExampleStore.getState().addItem("x");
		useExampleStore.getState().clear();
		expect(useExampleStore.getState().items).toHaveLength(0);
	});
});
