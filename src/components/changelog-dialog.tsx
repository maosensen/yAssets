/**
 * "What's New" — a user-facing changelog. Curated, translated highlights per
 * release (see src/lib/changelog), newest first, with the installed version
 * badged. Opened from the app menu bar and the library switcher; mounted in
 * AppDialogs so it works on every route and re-renders on a locale switch.
 */

import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { getChangelog } from "@/lib/changelog";
import { useUiStore } from "@/lib/stores/ui-store";
import { getLocale, T } from "@/lib/text";

function formatDate(iso: string, locale: string): string {
	// Parse as local midnight so the formatted day never shifts across time zones.
	const date = new Date(`${iso}T00:00:00`);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(date);
}

export function ChangelogDialog() {
	const open = useUiStore((state) => state.changelogOpen);
	const setOpen = useUiStore((state) => state.setChangelogOpen);
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

	const locale = getLocale();
	const releases = getChangelog();

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="flex max-h-[80vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
				<DialogHeader className="space-y-0.5 border-b px-6 py-4 text-left">
					<DialogTitle className="text-lg">{T.changelog.title}</DialogTitle>
					<DialogDescription>{T.changelog.subtitle}</DialogDescription>
				</DialogHeader>

				<ol className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
					{releases.map((release) => (
						<li key={release.version}>
							<div className="flex items-baseline gap-2">
								<span className="font-semibold text-sm tabular-nums">
									{release.version}
								</span>
								{release.version === version && (
									<Badge
										variant="secondary"
										className="px-1.5 py-0 text-[10px]"
									>
										{T.changelog.current}
									</Badge>
								)}
								<span className="ml-auto text-muted-foreground text-xs tabular-nums">
									{formatDate(release.date, locale)}
								</span>
							</div>
							<ul className="mt-2 flex flex-col gap-1.5">
								{release.highlights.map((highlight) => (
									<li
										key={highlight}
										className="flex gap-2.5 text-foreground/90 text-sm leading-relaxed"
									>
										<span className="mt-[0.5rem] size-1 shrink-0 rounded-full bg-primary/70" />
										<span className="min-w-0">{highlight}</span>
									</li>
								))}
							</ul>
						</li>
					))}
				</ol>
			</DialogContent>
		</Dialog>
	);
}
