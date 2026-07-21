/**
 * Customize a folder's appearance — glyph color and icon, in one popover.
 * Colors tint the folder glyph; icons are keys into the curated catalog.
 * Both fields support a "default" choice that clears back to the neutral look.
 */

import { useEffect, useState } from "react";
import {
	FOLDER_ICON_GROUPS,
	type FolderIconGroupId,
	resolveFolderIcon,
} from "@/components/folder-icon-catalog";
import { IconFolder } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useSetFolderAppearance } from "@/lib/queries/folders";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

/** Preset swatches (tailwind 500s) — shared visual language with tags. */
const FOLDER_COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#06b6d4",
	"#3b82f6",
	"#8b5cf6",
	"#ec4899",
] as const;

export type FolderCustomizeState = {
	folderId: string;
	name: string;
	color: string | null;
	icon: string | null;
};

type FolderCustomizeDialogProps = {
	state: FolderCustomizeState | null;
	onClose: () => void;
};

function groupLabel(id: FolderIconGroupId): string {
	return T.folderCustomize.groups[id];
}

export function FolderCustomizeDialog({
	state,
	onClose,
}: FolderCustomizeDialogProps) {
	const [color, setColor] = useState<string | null>(null);
	const [icon, setIcon] = useState<string | null>(null);
	const mutation = useSetFolderAppearance();

	useEffect(() => {
		setColor(state?.color ?? null);
		setIcon(state?.icon ?? null);
	}, [state]);

	const submit = () => {
		if (!state || mutation.isPending) return;
		mutation.mutate(
			{ id: state.folderId, color, icon },
			{ onSuccess: onClose },
		);
	};

	// Preview glyph reflects the pending selection.
	const PreviewIcon = resolveFolderIcon(icon) ?? IconFolder;
	const swatchTint = color ?? undefined;

	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<PreviewIcon
							className="size-5 shrink-0"
							style={swatchTint ? { color: swatchTint } : undefined}
						/>
						<span className="truncate">
							{state ? T.folderCustomize.title(state.name) : ""}
						</span>
					</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					{/* Color */}
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">
							{T.folderCustomize.colorLabel}
						</span>
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								aria-label={T.folderCustomize.colorDefault}
								className={cn(
									"flex size-6 items-center justify-center rounded-full border text-muted-foreground text-xs",
									color === null && "ring-2 ring-primary ring-offset-1",
								)}
								onClick={() => setColor(null)}
							>
								—
							</button>
							{FOLDER_COLORS.map((preset) => (
								<button
									key={preset}
									type="button"
									aria-label={preset}
									className={cn(
										"size-6 rounded-full border border-foreground/10",
										color === preset && "ring-2 ring-primary ring-offset-1",
									)}
									style={{ backgroundColor: preset }}
									onClick={() => setColor(preset)}
								/>
							))}
						</div>
					</div>

					{/* Icon */}
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">
							{T.folderCustomize.iconLabel}
						</span>
						<div className="max-h-64 overflow-y-auto pr-1">
							<button
								type="button"
								className={cn(
									"mb-2 flex items-center gap-2 rounded-md border px-2 py-1 text-sm",
									icon === null
										? "border-primary bg-sidebar-accent"
										: "border-transparent hover:bg-sidebar-accent",
								)}
								onClick={() => setIcon(null)}
							>
								<IconFolder
									className="size-4 shrink-0"
									style={swatchTint ? { color: swatchTint } : undefined}
								/>
								<span>{T.folderCustomize.iconDefault}</span>
							</button>
							{FOLDER_ICON_GROUPS.map((group) => (
								<div key={group.id} className="mb-2">
									<div className="px-0.5 py-1 text-[11px] text-muted-foreground">
										{groupLabel(group.id)}
									</div>
									<div className="grid grid-cols-8 gap-1">
										{group.keys.map((key) => {
											const Glyph = resolveFolderIcon(key);
											if (!Glyph) return null;
											const selected = icon === key;
											return (
												<button
													key={key}
													type="button"
													aria-label={key}
													className={cn(
														"flex aspect-square items-center justify-center rounded-md hover:bg-sidebar-accent",
														selected && "bg-sidebar-accent ring-2 ring-primary",
													)}
													onClick={() => setIcon(key)}
												>
													<Glyph
														className="size-[18px]"
														style={
															selected && swatchTint
																? { color: swatchTint }
																: undefined
														}
													/>
												</button>
											);
										})}
									</div>
								</div>
							))}
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={onClose}
						disabled={mutation.isPending}
					>
						{T.common.cancel}
					</Button>
					<Button onClick={submit} disabled={mutation.isPending}>
						{T.folderCustomize.save}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
