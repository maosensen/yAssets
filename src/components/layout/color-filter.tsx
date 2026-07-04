/**
 * Toolbar color filter — a swatch grid in a popover. Picking a hue navigates
 * to view=color&hue=N (its own scope, like tag); "all colors" returns to the
 * all view. Buckets match the Rust analyzer (12 × 30° + neutral).
 */

import { useNavigate } from "@tanstack/react-router";
import { IconPalette } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { LibraryView } from "@/lib/library-view";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

/** Representative color per hue bucket (bucket center ≈ i*30°+15°). */
export const HUE_SWATCHES: { hue: number; color: string }[] = [
	{ hue: 0, color: "#e5484d" },
	{ hue: 1, color: "#e5731d" },
	{ hue: 2, color: "#d9a400" },
	{ hue: 3, color: "#9bbf1a" },
	{ hue: 4, color: "#46b555" },
	{ hue: 5, color: "#26b58c" },
	{ hue: 6, color: "#20b7c4" },
	{ hue: 7, color: "#2e7bd6" },
	{ hue: 8, color: "#3550dd" },
	{ hue: 9, color: "#6a41d8" },
	{ hue: 10, color: "#a034c9" },
	{ hue: 11, color: "#d23197" },
];
export const NEUTRAL_HUE = 12;

export function ColorFilter({ search }: { search: LibraryView }) {
	const navigate = useNavigate();
	const active = search.view === "color" ? (search.hue ?? null) : null;

	const pick = (hue: number | null) => {
		if (hue === null) {
			void navigate({ to: "/", search: { view: "all" } });
		} else {
			void navigate({ to: "/", search: { view: "color", hue } });
		}
	};

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						className="size-8"
						title={T.colorFilter.label}
						aria-label={T.colorFilter.label}
					/>
				}
			>
				<IconPalette
					className={cn("size-4", active !== null && "text-primary")}
				/>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-2" align="end">
				<div className="grid grid-cols-6 gap-1.5">
					{HUE_SWATCHES.map(({ hue, color }) => (
						<button
							key={hue}
							type="button"
							aria-label={`${T.colorFilter.label} ${hue}`}
							className={cn(
								"size-6 rounded-full border border-foreground/10 transition-transform hover:scale-110",
								active === hue && "ring-2 ring-primary ring-offset-1",
							)}
							style={{ backgroundColor: color }}
							onClick={() => pick(hue)}
						/>
					))}
					<button
						type="button"
						aria-label={T.colorFilter.neutral}
						title={T.colorFilter.neutral}
						className={cn(
							"size-6 rounded-full border border-foreground/10 transition-transform hover:scale-110",
							active === NEUTRAL_HUE && "ring-2 ring-primary ring-offset-1",
						)}
						style={{
							background: "conic-gradient(#111,#555,#999,#ccc,#fff,#999,#111)",
						}}
						onClick={() => pick(NEUTRAL_HUE)}
					/>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="mt-2 w-full text-xs"
					onClick={() => pick(null)}
				>
					{T.colorFilter.all}
				</Button>
			</PopoverContent>
		</Popover>
	);
}
