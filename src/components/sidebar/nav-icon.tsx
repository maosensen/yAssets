/**
 * A sidebar nav glyph: linear by default, its filled (bold) counterpart when
 * the row is active/selected. This is the single, systematic place the app
 * swaps icon weight — the one exception to the linear-only default in
 * `icons.ts`. Callers pass both variants explicitly (icons are separate
 * modules, so the bold can't be derived from the linear at runtime).
 */

import type { IconComponent } from "@/components/icons";

export function NavIcon({
	line: Line,
	bold: Bold,
	active,
	className,
}: {
	line: IconComponent;
	bold: IconComponent;
	active: boolean;
	className?: string;
}) {
	const Glyph = active ? Bold : Line;
	return <Glyph className={className} />;
}
