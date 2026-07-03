/** Rename / recolor a tag — name field + preset color swatches. */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Tag } from "@/lib/bindings";
import { useUpdateTag } from "@/lib/queries/tags";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

/** Preset swatches (tailwind 500s) — enough identity without a color picker. */
const TAG_COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#06b6d4",
	"#3b82f6",
	"#8b5cf6",
	"#ec4899",
] as const;

type TagEditDialogProps = {
	tag: Tag | null;
	onClose: () => void;
};

export function TagEditDialog({ tag, onClose }: TagEditDialogProps) {
	const [name, setName] = useState("");
	const [color, setColor] = useState<string | null>(null);
	const updateMutation = useUpdateTag();

	useEffect(() => {
		setName(tag?.name ?? "");
		setColor(tag?.color ?? null);
	}, [tag]);

	const submit = () => {
		if (!tag || !name.trim() || updateMutation.isPending) return;
		updateMutation.mutate(
			{
				id: tag.id,
				name: name.trim() !== tag.name ? name.trim() : undefined,
				// Empty string clears the color on the Rust side.
				color: (color ?? "") !== (tag.color ?? "") ? (color ?? "") : undefined,
			},
			{ onSuccess: onClose },
		);
	};

	return (
		<Dialog open={tag !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{T.tags.editTitle}</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">
							{T.tags.nameLabel}
						</span>
						<Input
							autoFocus
							value={name}
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") submit();
							}}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">
							{T.tags.colorLabel}
						</span>
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								aria-label={T.tags.colorNone}
								className={cn(
									"flex size-6 items-center justify-center rounded-full border text-muted-foreground text-xs",
									color === null && "ring-2 ring-primary ring-offset-1",
								)}
								onClick={() => setColor(null)}
							>
								—
							</button>
							{TAG_COLORS.map((preset) => (
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
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={onClose}
						disabled={updateMutation.isPending}
					>
						{T.common.cancel}
					</Button>
					<Button
						onClick={submit}
						disabled={!name.trim() || updateMutation.isPending}
					>
						{T.tags.saveAction}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
