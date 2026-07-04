/**
 * Preferences dialog — Eagle-style left nav + right content pane.
 *
 * Phase 1.5 ships only General ▸ Appearance ▸ Theme. The section list and
 * the content switch are deliberately data-driven so new panes (Sidebar,
 * Shortcuts, …) drop in without restructuring.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type IconComponent,
	IconMonitor,
	IconMoon,
	IconReload,
	IconSettings,
	IconSun,
} from "@/components/icons";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { logger } from "@/lib/logger";
import { T } from "@/lib/text";
import { checkAndInstall } from "@/lib/updater";
import { cn } from "@/lib/utils";

type PreferencesDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type SectionId = "general";

const SECTIONS: Array<{
	id: SectionId;
	label: string;
	icon: IconComponent;
}> = [{ id: "general", label: T.preferences.navGeneral, icon: IconSettings }];

export function PreferencesDialog({
	open,
	onOpenChange,
}: PreferencesDialogProps) {
	const [section, setSection] = useState<SectionId>("general");

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[440px] max-w-2xl gap-0 overflow-hidden p-0 sm:max-w-2xl">
				<DialogTitle className="sr-only">{T.preferences.title}</DialogTitle>

				<nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-sidebar/40 p-2">
					<span className="px-2 py-1.5 font-semibold text-sm">
						{T.preferences.title}
					</span>
					{SECTIONS.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							className={cn(
								"flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
								section === id
									? "bg-accent font-medium text-accent-foreground"
									: "text-foreground/80 hover:bg-accent/60",
							)}
							onClick={() => setSection(id)}
						>
							<Icon className="size-4" />
							{label}
						</button>
					))}
				</nav>

				<div className="min-w-0 flex-1 overflow-y-auto p-5">
					{section === "general" && <GeneralPane />}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function GeneralPane() {
	const { theme, setTheme } = useTheme();
	const [checking, setChecking] = useState(false);

	const checkUpdates = async () => {
		setChecking(true);
		try {
			const outcome = await checkAndInstall();
			if (outcome === "none") toast.info(T.preferences.upToDate);
		} catch (error) {
			logger.warn({ error }, "update check failed");
			toast.error(T.preferences.updateFailed);
		} finally {
			setChecking(false);
		}
	};

	return (
		<div className="flex flex-col gap-5">
			<Section title={T.preferences.sectionAppearance}>
				<Row label={T.preferences.theme}>
					<div className="flex gap-1.5">
						<ThemeChip
							active={theme === "light"}
							icon={<IconSun className="size-4" />}
							label={T.preferences.themeLight}
							onClick={() => setTheme("light")}
						/>
						<ThemeChip
							active={theme === "dark"}
							icon={<IconMoon className="size-4" />}
							label={T.preferences.themeDark}
							onClick={() => setTheme("dark")}
						/>
						<ThemeChip
							active={theme === "system"}
							icon={<IconMonitor className="size-4" />}
							label={T.preferences.themeSystem}
							onClick={() => setTheme("system")}
						/>
					</div>
				</Row>
			</Section>

			<Section title={T.preferences.sectionUpdates}>
				<Row label={T.app.name}>
					<Button
						variant="outline"
						size="sm"
						disabled={checking}
						onClick={() => void checkUpdates()}
					>
						<IconReload className="size-3.5" />
						{checking
							? T.preferences.checkingUpdates
							: T.preferences.checkUpdates}
					</Button>
				</Row>
			</Section>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-3">
			<h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{title}
			</h3>
			{children}
		</section>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<span className="text-sm">{label}</span>
			{children}
		</div>
	);
}

function ThemeChip({
	active,
	icon,
	label,
	onClick,
}: {
	active: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				"flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
				active
					? "border-primary bg-primary/10 text-foreground"
					: "border-transparent bg-muted/50 text-foreground/80 hover:bg-muted",
			)}
		>
			{icon}
			{label}
		</button>
	);
}
