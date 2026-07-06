/**
 * Current-library dropdown at the top of the sidebar: recent libraries,
 * open-other, create-new, close-current — Eagle's top-left switcher.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AboutDialog } from "@/components/about-dialog";
import { DuplicatesDialog } from "@/components/duplicates/duplicates-dialog";
import {
	IconClose,
	IconCopy,
	IconFolderAdd,
	IconFolderOpen,
	IconInfo,
	IconLibrary,
	IconReload,
	IconSettings,
	IconSwitcher,
} from "@/components/icons";
import { PreferencesDialog } from "@/components/preferences/preferences-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLibraryActions } from "@/hooks/use-library-actions";
import {
	currentLibraryQueryOptions,
	recentLibrariesQueryOptions,
} from "@/lib/queries/library";
import { useUiStore } from "@/lib/stores/ui-store";
import { T } from "@/lib/text";
import { runUpdateCheck } from "@/lib/update-actions";

export function LibrarySwitcher() {
	const { data: library } = useQuery(currentLibraryQueryOptions());
	const { data: recents } = useQuery(recentLibrariesQueryOptions());
	const actions = useLibraryActions();
	// Kept in the UI store (not local state) so the dialog survives the locale
	// remount when the user switches language from inside Preferences.
	const prefsOpen = useUiStore((state) => state.preferencesOpen);
	const setPrefsOpen = useUiStore((state) => state.setPreferencesOpen);
	const setAboutOpen = useUiStore((state) => state.setAboutOpen);
	const [duplicatesOpen, setDuplicatesOpen] = useState(false);

	const otherRecents = (recents ?? []).filter(
		(entry) => entry.path !== library?.path,
	);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							className="w-full justify-start gap-2 px-2"
							disabled={actions.busy}
						/>
					}
				>
					<IconLibrary className="size-4 shrink-0" />
					<span className="min-w-0 flex-1 truncate text-left font-medium">
						{library?.name ?? T.app.name}
					</span>
					<IconSwitcher className="size-3.5 shrink-0 text-muted-foreground" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-64">
					{otherRecents.length > 0 && (
						<>
							{/* Base UI hard-requires GroupLabel to live inside a Group —
						    a bare label throws MenuGroupContext at runtime. */}
							<DropdownMenuGroup>
								<DropdownMenuLabel>
									{T.sidebar.switcher.recentGroup}
								</DropdownMenuLabel>
								{otherRecents.map((entry) => (
									<DropdownMenuItem
										key={entry.path}
										disabled={entry.missing}
										onClick={() => actions.openPath(entry.path)}
									>
										<span className="min-w-0 flex-1 truncate">
											{entry.name}
										</span>
										{entry.missing && (
											<span className="text-muted-foreground text-xs">
												{T.welcome.missingBadge}
											</span>
										)}
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
						</>
					)}
					<DropdownMenuItem onClick={() => void actions.pickAndOpen()}>
						<IconFolderOpen className="size-4" />
						{T.sidebar.switcher.openOther}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => void actions.pickAndCreate()}>
						<IconFolderAdd className="size-4" />
						{T.sidebar.switcher.createNew}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => setDuplicatesOpen(true)}>
						<IconCopy className="size-4" />
						{T.duplicatesCenter.open}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setPrefsOpen(true)}>
						<IconSettings className="size-4" />
						{T.preferences.open}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => void runUpdateCheck()}>
						<IconReload className="size-4" />
						{T.preferences.checkUpdates}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setAboutOpen(true)}>
						<IconInfo className="size-4" />
						{T.about.title}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => actions.closeCurrent()}>
						<IconClose className="size-4" />
						{T.sidebar.switcher.closeCurrent}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
			<AboutDialog />
			<DuplicatesDialog
				open={duplicatesOpen}
				onOpenChange={setDuplicatesOpen}
			/>
		</>
	);
}
