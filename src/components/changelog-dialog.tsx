/**
 * "What's New" — a user-facing changelog. Curated, translated, categorized
 * highlights per release (see src/lib/changelog), newest first, with the
 * installed version badged. Two-column layout: a version/date rail beside the
 * categorized changes. Mounted in AppDialogs so it works on every route and
 * re-renders on a locale switch.
 */

import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { type ChangeKind, getChangelog } from "@/lib/changelog";
import { useUiStore } from "@/lib/stores/ui-store";
import { getLocale, T } from "@/lib/text";
import { cn } from "@/lib/utils";

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

	// Colored category tags — built in render so labels track the locale.
	const kindMeta: Record<ChangeKind, { label: string; className: string }> = {
		new: {
			label: T.changelog.kindNew,
			className:
				"bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
		},
		improved: {
			label: T.changelog.kindImproved,
			className:
				"bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
		},
		fixed: {
			label: T.changelog.kindFixed,
			className:
				"bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
		},
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
				{/* Faint accent glow behind the title — quiet chrome to lift the
				    header off a flat background. (DialogContent is `fixed`, which
				    is the positioning context this absolute child anchors to.) */}
				<div
					aria-hidden
					className="pointer-events-none absolute -top-20 left-1/2 h-40 w-80 -translate-x-1/2 rounded-full bg-primary/25 blur-3xl"
				/>

				<DialogHeader className="relative space-y-1 border-b px-6 py-5 text-left">
					<DialogTitle className="text-xl tracking-tight">
						{T.changelog.title}
					</DialogTitle>
					<DialogDescription>{T.changelog.subtitle}</DialogDescription>
				</DialogHeader>

				<ol className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 py-6">
					{releases.map((release) => (
						<li key={release.version} className="flex gap-5">
							<div className="w-24 shrink-0 pt-0.5">
								<div className="font-semibold text-sm tabular-nums">
									{release.version}
								</div>
								<div className="mt-0.5 text-muted-foreground text-xs">
									{formatDate(release.date, locale)}
								</div>
								{release.version === version && (
									<div className="mt-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[10px] text-primary">
										{T.changelog.current}
									</div>
								)}
							</div>

							<ul className="min-w-0 flex-1 space-y-2.5 border-border/60 border-l pl-5">
								{release.changes.map((change) => (
									<li
										key={change.text}
										className="grid grid-cols-[4.5rem_1fr] items-baseline gap-3"
									>
										<span
											className={cn(
												"inline-flex justify-self-start rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide",
												kindMeta[change.kind].className,
											)}
										>
											{kindMeta[change.kind].label}
										</span>
										<span className="text-foreground/90 text-sm leading-relaxed">
											{change.text}
										</span>
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
