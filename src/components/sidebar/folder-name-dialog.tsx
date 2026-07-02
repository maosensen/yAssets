/** Shared create/rename folder dialog — one non-empty text field. */

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
import { useCreateFolder, useRenameFolder } from "@/lib/queries/folders";
import { T } from "@/lib/text";

export type FolderDialogState =
	| { mode: "create"; parentId: string | null; parentName?: string }
	| { mode: "rename"; folderId: string; currentName: string };

type FolderNameDialogProps = {
	state: FolderDialogState | null;
	onClose: () => void;
};

export function FolderNameDialog({ state, onClose }: FolderNameDialogProps) {
	const [name, setName] = useState("");
	const createMutation = useCreateFolder();
	const renameMutation = useRenameFolder();
	const pending = createMutation.isPending || renameMutation.isPending;

	useEffect(() => {
		setName(state?.mode === "rename" ? state.currentName : "");
	}, [state]);

	const title =
		state?.mode === "rename"
			? T.folderDialog.renameTitle
			: state?.parentName
				? T.folderDialog.createChildTitle(state.parentName)
				: T.folderDialog.createTitle;

	const submit = () => {
		if (!state || !name.trim() || pending) return;
		const options = { onSuccess: onClose };
		if (state.mode === "create") {
			createMutation.mutate(
				{ name: name.trim(), parentId: state.parentId },
				options,
			);
		} else {
			renameMutation.mutate({ id: state.folderId, name: name.trim() }, options);
		}
	};

	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<Input
					autoFocus
					value={name}
					placeholder={T.folderDialog.namePlaceholder}
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") submit();
					}}
				/>
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{T.common.cancel}
					</Button>
					<Button onClick={submit} disabled={!name.trim() || pending}>
						{state?.mode === "rename"
							? T.folderDialog.renameAction
							: T.folderDialog.createAction}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
