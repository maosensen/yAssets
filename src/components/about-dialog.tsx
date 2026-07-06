/**
 * About card — app identity at a glance: icon tile, name, tagline, version and
 * copyright. Opened from the native app menu (macOS) and the library-switcher
 * menu; its open state lives in the UI store so it survives the locale remount.
 */

import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { IconLibrary } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useUiStore } from "@/lib/stores/ui-store";
import { T } from "@/lib/text";

export function AboutDialog() {
	const open = useUiStore((state) => state.aboutOpen);
	const setOpen = useUiStore((state) => state.setAboutOpen);
	const [version, setVersion] = useState("");

	useEffect(() => {
		if (!open || version) return;
		let active = true;
		getVersion()
			.then((v) => {
				if (active) setVersion(v);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [open, version]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-xs gap-0 p-0">
				<DialogHeader className="sr-only">
					<DialogTitle>{T.about.title}</DialogTitle>
					<DialogDescription>{T.welcome.tagline}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col items-center gap-2 px-8 pt-9 pb-7 text-center">
					<div className="flex size-16 items-center justify-center rounded-[18px] bg-gradient-to-br from-primary to-blue-600 shadow-lg">
						<IconLibrary className="size-9 text-white" />
					</div>
					<div className="mt-2 font-semibold text-2xl tracking-tight">
						{T.app.name}
					</div>
					<p className="text-muted-foreground text-sm">{T.welcome.tagline}</p>
					{version && (
						<p className="text-muted-foreground/70 text-xs tabular-nums">
							{T.about.version(version)}
						</p>
					)}
					<Button className="mt-4 w-full" onClick={() => setOpen(false)}>
						{T.about.ok}
					</Button>
					<p className="mt-1 text-[11px] text-muted-foreground/60">
						{T.about.copyright}
					</p>
				</div>
			</DialogContent>
		</Dialog>
	);
}
