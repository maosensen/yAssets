/**
 * Preferences dialog — Eagle-style left nav + right content pane.
 *
 * Phase 1.5 ships only General ▸ Appearance ▸ Theme. The section list and
 * the content switch are deliberately data-driven so new panes (Sidebar,
 * Shortcuts, …) drop in without restructuring.
 */

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import {
	IconArchive,
	type IconComponent,
	IconFolderAdd,
	IconFolderOpen,
	IconMonitor,
	IconMoon,
	IconReload,
	IconSettings,
	IconSun,
	IconTrash,
} from "@/components/icons";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { pickDirectory } from "@/lib/dialogs";
import { formatBytes } from "@/lib/format";
import { logger } from "@/lib/logger";
import {
	maintenanceReportQueryOptions,
	useCleanOrphans,
	useVacuumDatabase,
	useVerifyIntegrity,
} from "@/lib/queries/maintenance";
import {
	useAddWatchedFolder,
	useRemoveWatchedFolder,
	useSetWatchedFolderEnabled,
	watchedFoldersQueryOptions,
} from "@/lib/queries/watched-folders";
import { T } from "@/lib/text";
import { checkAndInstall } from "@/lib/updater";
import { cn } from "@/lib/utils";

type PreferencesDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type SectionId = "general" | "watched" | "maintenance";

const SECTIONS: Array<{
	id: SectionId;
	label: string;
	icon: IconComponent;
}> = [
	{ id: "general", label: T.preferences.navGeneral, icon: IconSettings },
	{ id: "watched", label: T.preferences.navWatched, icon: IconFolderOpen },
	{ id: "maintenance", label: T.preferences.navMaintenance, icon: IconArchive },
];

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
					{section === "watched" && <WatchedFoldersPane />}
					{section === "maintenance" && <MaintenancePane />}
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

function WatchedFoldersPane() {
	const { data: folders } = useQuery(watchedFoldersQueryOptions());
	const add = useAddWatchedFolder();
	const setEnabled = useSetWatchedFolderEnabled();
	const remove = useRemoveWatchedFolder();

	const onAdd = async () => {
		const dir = await pickDirectory(T.watched.add);
		if (dir) add.mutate({ path: dir, folderId: null });
	};

	const rows = folders ?? [];
	return (
		<div className="flex flex-col gap-4">
			<Section title={T.preferences.navWatched}>
				<p className="text-muted-foreground text-xs leading-relaxed">
					{T.watched.description}
				</p>
				<div className="flex flex-col gap-1.5">
					{rows.length === 0 ? (
						<p className="py-2 text-muted-foreground text-sm">
							{T.watched.empty}
						</p>
					) : (
						rows.map((folder) => (
							<div
								key={folder.id}
								className="flex items-center gap-3 rounded-md border px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm" title={folder.path}>
										{folder.path}
									</div>
									<div className="text-muted-foreground text-xs">
										{T.watched.autoImport}
									</div>
								</div>
								<Switch
									checked={folder.auto_import}
									onCheckedChange={(checked) =>
										setEnabled.mutate({ id: folder.id, enabled: checked })
									}
								/>
								<Button
									variant="ghost"
									size="icon"
									className="size-7 shrink-0"
									aria-label={T.watched.remove}
									title={T.watched.remove}
									onClick={() => remove.mutate(folder.id)}
								>
									<IconTrash className="size-4" />
								</Button>
							</div>
						))
					)}
				</div>
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					disabled={add.isPending}
					onClick={() => void onAdd()}
				>
					<IconFolderAdd className="size-4" />
					{T.watched.add}
				</Button>
			</Section>
		</div>
	);
}

function MaintenancePane() {
	const { data: report } = useQuery(maintenanceReportQueryOptions());
	const vacuum = useVacuumDatabase();
	const verify = useVerifyIntegrity();
	const clean = useCleanOrphans();
	// Two-step confirm — cleanup permanently deletes files (no soft delete).
	const [confirmClean, setConfirmClean] = useState(false);
	const orphanCount =
		(report?.orphan_asset_files ?? 0) + (report?.orphan_thumbnails ?? 0);
	const busy = vacuum.isPending || verify.isPending || clean.isPending;

	return (
		<div className="flex flex-col gap-5">
			<Section title={T.preferences.navMaintenance}>
				<p className="text-muted-foreground text-xs leading-relaxed">
					{T.maintenance.description}
				</p>
				<div className="flex flex-col gap-1.5 text-sm">
					<div className="flex items-center justify-between">
						<span>{T.maintenance.databaseSize}</span>
						<span className="text-muted-foreground tabular-nums">
							{report ? formatBytes(report.db_bytes ?? 0) : "—"}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span>
							{orphanCount > 0
								? T.maintenance.orphans(orphanCount)
								: T.maintenance.noOrphans}
						</span>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => vacuum.mutate()}
					>
						<IconArchive className="size-3.5" />
						{vacuum.isPending ? T.maintenance.busy : T.maintenance.vacuum}
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => verify.mutate()}
					>
						<IconReload className="size-3.5" />
						{verify.isPending ? T.maintenance.busy : T.maintenance.verify}
					</Button>
					<Button
						variant={confirmClean ? "destructive" : "outline"}
						size="sm"
						disabled={busy || orphanCount === 0}
						onClick={() => {
							if (confirmClean) {
								clean.mutate();
								setConfirmClean(false);
							} else {
								setConfirmClean(true);
							}
						}}
					>
						<IconTrash className="size-3.5" />
						{clean.isPending
							? T.maintenance.busy
							: confirmClean
								? T.maintenance.cleanConfirm
								: T.maintenance.clean}
					</Button>
				</div>
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
