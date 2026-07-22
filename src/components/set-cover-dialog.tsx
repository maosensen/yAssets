/**
 * Set-Cover dialog — give an asset (typically a link bookmark that got no auto
 * cover) a manual cover by pasting an image (⌘V) or uploading a file. Both
 * inputs stay inside the webview as a Blob → base64, preview before saving,
 * and apply through the shared captured-cover pipeline. Driven by the UI store
 * so any entry point (context menu, inspector) opens the same dialog.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IconImportImages } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useSetAssetCover } from "@/lib/queries/assets";
import { useUiStore } from "@/lib/stores/ui-store";
import { T } from "@/lib/text";

type Staged = {
	/** data: URL for the preview. */
	url: string;
	/** Raw base64 (no data-URL prefix) for the backend. */
	base64: string;
	width: number;
	height: number;
};

function readDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error ?? new Error("read failed"));
		reader.readAsDataURL(blob);
	});
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () =>
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
		img.onerror = () => reject(new Error("decode failed"));
		img.src = src;
	});
}

export function SetCoverDialog() {
	const assetId = useUiStore((state) => state.coverAssetId);
	const close = useUiStore((state) => state.closeCoverDialog);
	const setCover = useSetAssetCover();
	const [staged, setStaged] = useState<Staged | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const open = assetId !== null;

	// Fresh staging area each time the dialog opens.
	useEffect(() => {
		if (!open) setStaged(null);
	}, [open]);

	const stage = useCallback(async (blob: Blob) => {
		if (!blob.type.startsWith("image/")) {
			toast.error(T.cover.invalid);
			return;
		}
		try {
			const url = await readDataUrl(blob);
			const { width, height } = await imageSize(url);
			setStaged({
				url,
				base64: url.slice(url.indexOf(",") + 1),
				width,
				height,
			});
		} catch {
			toast.error(T.cover.invalid);
		}
	}, []);

	// Paste an image from anywhere while the dialog is open.
	useEffect(() => {
		if (!open) return;
		const onPaste = (event: ClipboardEvent) => {
			const items = event.clipboardData?.items;
			if (!items) return;
			for (const item of items) {
				if (item.kind === "file" && item.type.startsWith("image/")) {
					const file = item.getAsFile();
					if (file) {
						event.preventDefault();
						void stage(file);
						return;
					}
				}
			}
		};
		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, [open, stage]);

	const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = ""; // let the same file be re-picked later
		if (file) void stage(file);
	};

	const save = () => {
		if (!assetId || !staged) return;
		setCover.mutate(
			{
				id: assetId,
				dataBase64: staged.base64,
				width: staged.width,
				height: staged.height,
			},
			{ onSuccess: () => close() },
		);
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{T.cover.title}</DialogTitle>
				</DialogHeader>

				<button
					type="button"
					className="flex min-h-40 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-dashed bg-muted p-2 text-muted-foreground text-sm transition-colors hover:bg-muted/70"
					onClick={() => inputRef.current?.click()}
				>
					{staged ? (
						<img
							src={staged.url}
							alt=""
							className="max-h-56 max-w-full object-contain"
							draggable={false}
						/>
					) : (
						<>
							<IconImportImages className="size-6" />
							<span className="px-4 text-center">{T.cover.hint}</span>
						</>
					)}
				</button>
				<input
					ref={inputRef}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={onFile}
				/>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={close}
						disabled={setCover.isPending}
					>
						{T.common.cancel}
					</Button>
					<Button onClick={save} disabled={!staged || setCover.isPending}>
						{T.cover.save}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
