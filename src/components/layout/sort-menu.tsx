/**
 * Sort control — a dropdown in the toolbar picking the grid's sort key and
 * direction. Reads/writes the persisted `view-prefs` store; `useLibraryAssetList`
 * already threads sort/dir into the list query, so no query wiring is needed.
 */

import { IconSort } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SortDir, SortKey } from "@/lib/bindings";
import { useViewPrefsStore } from "@/lib/stores/view-prefs-store";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

// Built in render (not at module scope) so the labels re-read `T` on a locale
// switch; the `value`s are locale-independent enum members.
const SORT_KEYS: Array<{ value: SortKey; label: () => string }> = [
	{ value: "ImportedAt", label: () => T.sort.byImportedAt },
	{ value: "Name", label: () => T.sort.byName },
	{ value: "Size", label: () => T.sort.bySize },
	{ value: "Rating", label: () => T.sort.byRating },
	{ value: "UpdatedAt", label: () => T.sort.byUpdatedAt },
];

const SORT_DIRS: Array<{ value: SortDir; label: () => string }> = [
	{ value: "Desc", label: () => T.sort.desc },
	{ value: "Asc", label: () => T.sort.asc },
];

export function SortMenu() {
	const sort = useViewPrefsStore((state) => state.sort);
	const dir = useViewPrefsStore((state) => state.dir);
	const setSort = useViewPrefsStore((state) => state.setSort);
	// Tint the trigger when the order is anything but the default.
	const isDefault = sort === "ImportedAt" && dir === "Desc";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						className="size-8"
						aria-label={T.sort.label}
						title={T.sort.label}
					/>
				}
			>
				<IconSort className={cn("size-4", !isDefault && "text-primary")} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>{T.sort.label}</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={sort}
					onValueChange={(value) => setSort(value as SortKey, dir)}
				>
					{SORT_KEYS.map((key) => (
						<DropdownMenuRadioItem key={key.value} value={key.value}>
							{key.label()}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup
					value={dir}
					onValueChange={(value) => setSort(sort, value as SortDir)}
				>
					{SORT_DIRS.map((direction) => (
						<DropdownMenuRadioItem
							key={direction.value}
							value={direction.value}
						>
							{direction.label()}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
