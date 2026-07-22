/**
 * Five-star rating, keyboard-accessible. Clicking the current value clears
 * to 0 (Eagle behavior); arrow keys step the value. Earned stars are a solid
 * amber glyph (the universal rating gold, not the app's theme color); hovering
 * previews the value up to the pointer, and the hovered star pops.
 */

import { useState } from "react";
import { IconStar, IconStarBold } from "@/components/icons";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

type RatingStarsProps = {
	value: number;
	onChange: (value: number) => void;
};

export function RatingStars({ value, onChange }: RatingStarsProps) {
	// 0 = not hovering; otherwise preview the fill up to this star.
	const [hover, setHover] = useState(0);
	const shown = hover || value;

	return (
		// fieldset carries the implicit "group" role the a11y rule asks for.
		<fieldset
			aria-label={T.inspector.ratingLabel}
			className="m-0 flex items-center gap-0.5 border-0 p-0"
			onPointerLeave={() => setHover(0)}
			onKeyDown={(event) => {
				if (event.key === "ArrowRight") {
					event.preventDefault();
					onChange(Math.min(5, value + 1));
				} else if (event.key === "ArrowLeft") {
					event.preventDefault();
					onChange(Math.max(0, value - 1));
				}
			}}
		>
			{[1, 2, 3, 4, 5].map((star) => {
				const filled = star <= shown;
				const Glyph = filled ? IconStarBold : IconStar;
				return (
					<button
						key={star}
						type="button"
						aria-pressed={value === star}
						aria-label={T.inspector.starLabel(star)}
						className="rounded p-0.5 outline-none transition-transform duration-150 hover:scale-125 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
						onPointerEnter={() => setHover(star)}
						onClick={() => onChange(star === value ? 0 : star)}
					>
						<Glyph
							className={cn(
								"size-4 transition-colors duration-150",
								filled ? "text-amber-400" : "text-muted-foreground/35",
							)}
						/>
					</button>
				);
			})}
		</fieldset>
	);
}
