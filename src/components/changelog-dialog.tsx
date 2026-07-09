/**
 * "What's New" — a user-facing changelog. Curated, translated, categorized
 * highlights per release (see src/lib/changelog), newest first, with the
 * installed version badged. Release-notes layout: a timeline rail with a dot
 * per release, a mono version chip and date, a headline plus summary, then a
 * card of categorized changes. Mounted in AppDialogs so it works on every
 * route and re-renders on a locale switch.
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
	// "New" borrows the accent so it matches the version chip; the other two
	// keep distinct hues for scanning.
	const kindMeta: Record<ChangeKind, { label: string; className: string }> = {
		new: {
			label: T.changelog.kindNew,
			className: "bg-primary/10 text-primary dark:bg-primary/15",
		},
		improved: {
			label: T.changelog.kindImproved,
			className:
				"bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
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

				<ol className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
					{releases.map((release, index) => (
						<li key={release.version} className="relative pb-10 pl-7 last:pb-2">
							{/* Timeline rail: an accent dot per release, joined by a
							    hairline down to the next entry. */}
							<span
								aria-hidden
								className="absolute top-1 left-0 size-[11px] rounded-full bg-primary ring-4 ring-primary/15"
							/>
							{index < releases.length - 1 && (
								<span
									aria-hidden
									className="absolute top-5 bottom-0 left-[5px] w-px bg-border/70"
								/>
							)}

							<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
								<span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium font-mono text-primary text-xs dark:bg-primary/15">
									v{release.version}
								</span>
								<span className="font-mono text-muted-foreground text-xs">
									{formatDate(release.date, locale)}
								</span>
								{release.version === version && (
									<span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[10px] text-primary dark:bg-primary/15">
										{T.changelog.current}
									</span>
								)}
							</div>

							<h3 className="mt-3 font-bold text-foreground text-xl tracking-tight">
								{release.title}
							</h3>
							{release.summary && (
								<p className="mt-1.5 max-w-prose text-muted-foreground text-sm leading-relaxed">
									{release.summary}
								</p>
							)}

							<ul className="mt-4 divide-y divide-border/60 rounded-xl border border-border/60 bg-card/40">
								{release.changes.map((change) => (
									<li key={change.text} className="flex gap-4 px-4 py-4">
										<span className="w-[4.75rem] shrink-0 pt-0.5">
											<span
												className={cn(
													"inline-flex rounded-full px-2.5 py-0.5 font-medium text-[10px] uppercase tracking-wider",
													kindMeta[change.kind].className,
												)}
											>
												{kindMeta[change.kind].label}
											</span>
										</span>
										<div className="min-w-0 flex-1">
											{change.title && (
												<div className="font-semibold text-foreground text-sm">
													{change.title}
												</div>
											)}
											<p
												className={cn(
													"text-muted-foreground text-sm leading-relaxed",
													change.title && "mt-1",
												)}
											>
												{change.text}
											</p>
										</div>
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
