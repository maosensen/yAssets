/**
 * Five-star rating, keyboard-accessible. Clicking the current value clears
 * to 0 (Eagle behavior); arrow keys step the value.
 */

import { IconStar } from "@/components/icons";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

type RatingStarsProps = {
	value: number;
	onChange: (value: number) => void;
};

export function RatingStars({ value, onChange }: RatingStarsProps) {
	return (
		// fieldset carries the implicit "group" role the a11y rule asks for.
		<fieldset
			aria-label={T.inspector.ratingLabel}
			className="m-0 flex items-center gap-0.5 border-0 p-0"
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
			{[1, 2, 3, 4, 5].map((star) => (
				<button
					key={star}
					type="button"
					aria-pressed={value === star}
					aria-label={T.inspector.starLabel(star)}
					className="rounded p-0.5 outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => onChange(star === value ? 0 : star)}
				>
					<IconStar
						className={cn(
							"size-4 transition-colors",
							star <= value ? "text-primary" : "text-muted-foreground/40",
						)}
					/>
				</button>
			))}
		</fieldset>
	);
}
