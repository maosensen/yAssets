import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RatingStars } from "./rating-stars";

describe("RatingStars", () => {
	it("renders five stars with the current value pressed", () => {
		render(<RatingStars value={3} onChange={() => {}} />);
		const stars = screen.getAllByRole("button");
		expect(stars).toHaveLength(5);
		expect(stars[2]).toHaveAttribute("aria-pressed", "true");
	});

	it("clicking a star selects it", () => {
		const onChange = vi.fn();
		render(<RatingStars value={0} onChange={onChange} />);
		fireEvent.click(screen.getByRole("button", { name: "4 星" }));
		expect(onChange).toHaveBeenCalledWith(4);
	});

	it("clicking the current value clears to zero", () => {
		const onChange = vi.fn();
		render(<RatingStars value={4} onChange={onChange} />);
		fireEvent.click(screen.getByRole("button", { name: "4 星" }));
		expect(onChange).toHaveBeenCalledWith(0);
	});

	it("arrow keys step the value within 0-5", () => {
		const onChange = vi.fn();
		render(<RatingStars value={5} onChange={onChange} />);
		fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalledWith(5); // clamped
		fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowLeft" });
		expect(onChange).toHaveBeenCalledWith(4);
	});
});
