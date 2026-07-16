/**
 * Preferences dialog — Eagle-style shell: a left nav column and a right pane
 * whose top bar names the active section and hosts the close button, with the
 * settings themselves grouped into rounded cards.
 *
 * The section list and the content switch are data-driven so new panes drop in
 * without restructuring. Everything applies instantly (theme/locale/api keys
 * persist on change), so there is deliberately no Save/Apply footer.
 */

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import {
	IconArchive,
	IconClose,
	type IconComponent,
	IconCopy,
	IconFolderAdd,
	IconFolderOpen,
	IconLink,
	IconMonitor,
	IconMoon,
	IconReload,
	IconSettings,
	IconSun,
	IconTrash,
} from "@/components/icons";
import { type Theme, useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { pickDirectory } from "@/lib/dialogs";
import { formatBytes } from "@/lib/format";
import {
	collectStatusQueryOptions,
	useInstallVideoTool,
	useRegenerateCollectToken,
	useSetCollectEnabled,
	videoToolStatusQueryOptions,
} from "@/lib/queries/collect";
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
import { useLocaleStore } from "@/lib/stores/locale-store";
import { useSourcesStore } from "@/lib/stores/sources-store";
import { type LocaleCode, localeCodes, T } from "@/lib/text";
import { runUpdateCheck } from "@/lib/update-actions";
import { cn } from "@/lib/utils";

type PreferencesDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/** Language names shown in their own script — locale-independent, so they read
 *  identically regardless of the active UI language. */
const LANGUAGE_NAMES: Record<LocaleCode, string> = {
	en: "English",
	zh: "中文",
	ja: "日本語",
};

type SectionId = "general" | "collect" | "watched" | "maintenance";

export function PreferencesDialog({
	open,
	onOpenChange,
}: PreferencesDialogProps) {
	const [section, setSection] = useState<SectionId>("general");

	// Built in render (not at module scope) so labels re-read `T` on a locale
	// switch.
	const sections: Array<{ id: SectionId; label: string; icon: IconComponent }> =
		[
			{ id: "general", label: T.preferences.navGeneral, icon: IconSettings },
			{ id: "collect", label: T.collect.title, icon: IconLink },
			{ id: "watched", label: T.preferences.navWatched, icon: IconFolderOpen },
			{
				id: "maintenance",
				label: T.preferences.navMaintenance,
				icon: IconArchive,
			},
		];
	const activeLabel = sections.find((s) => s.id === section)?.label ?? "";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="flex h-[560px] max-h-[85vh] w-full max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl"
			>
				<DialogTitle className="sr-only">{T.preferences.title}</DialogTitle>

				<nav className="flex w-48 shrink-0 flex-col border-r bg-sidebar/40">
					<div className="flex h-14 shrink-0 items-center px-4">
						<span className="font-heading font-semibold text-sm">
							{T.preferences.title}
						</span>
					</div>
					<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
						{sections.map(({ id, label, icon: Icon }) => {
							const active = section === id;
							return (
								<button
									key={id}
									type="button"
									onClick={() => setSection(id)}
									className={cn(
										"flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
										active
											? "bg-accent font-medium text-accent-foreground"
											: "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
									)}
								>
									<Icon
										className={cn(
											"size-4 shrink-0",
											active ? "text-foreground" : "text-muted-foreground",
										)}
									/>
									{label}
								</button>
							);
						})}
					</div>
				</nav>

				<div className="flex min-w-0 flex-1 flex-col">
					<header className="flex h-14 shrink-0 items-center justify-between border-b px-5">
						<h2 className="font-heading font-medium text-base">
							{activeLabel}
						</h2>
						<DialogClose
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									className="rounded-full text-muted-foreground hover:text-foreground"
								/>
							}
						>
							<IconClose />
							<span className="sr-only">{T.common.close}</span>
						</DialogClose>
					</header>

					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
						{section === "general" && <GeneralPane />}
						{section === "collect" && <CollectPane />}
						{section === "watched" && <WatchedFoldersPane />}
						{section === "maintenance" && <MaintenancePane />}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function GeneralPane() {
	const { theme, setTheme } = useTheme();
	const locale = useLocaleStore((state) => state.locale);
	const setLocale = useLocaleStore((state) => state.setLocale);
	const wallhavenApiKey = useSourcesStore((state) => state.wallhavenApiKey);
	const setWallhavenApiKey = useSourcesStore(
		(state) => state.setWallhavenApiKey,
	);
	const pixabayApiKey = useSourcesStore((state) => state.pixabayApiKey);
	const setPixabayApiKey = useSourcesStore((state) => state.setPixabayApiKey);
	const pexelsApiKey = useSourcesStore((state) => state.pexelsApiKey);
	const setPexelsApiKey = useSourcesStore((state) => state.setPexelsApiKey);
	const [checking, setChecking] = useState(false);

	const checkUpdates = async () => {
		setChecking(true);
		try {
			await runUpdateCheck();
		} finally {
			setChecking(false);
		}
	};

	return (
		<div className="flex flex-col gap-5">
			<SettingsCard title={T.preferences.sectionAppearance}>
				<SettingRow label={T.preferences.theme}>
					<Segmented<Theme>
						value={theme}
						onChange={setTheme}
						options={[
							{
								value: "light",
								label: T.preferences.themeLight,
								icon: <IconSun className="size-3.5" />,
							},
							{
								value: "dark",
								label: T.preferences.themeDark,
								icon: <IconMoon className="size-3.5" />,
							},
							{
								value: "system",
								label: T.preferences.themeSystem,
								icon: <IconMonitor className="size-3.5" />,
							},
						]}
					/>
				</SettingRow>
				<SettingRow label={T.preferences.language}>
					<Segmented<LocaleCode>
						value={locale}
						onChange={setLocale}
						options={localeCodes.map((code) => ({
							value: code,
							label: LANGUAGE_NAMES[code],
						}))}
					/>
				</SettingRow>
			</SettingsCard>

			<SettingsCard title={T.preferences.sectionUpdates}>
				<SettingRow label={T.app.name}>
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
				</SettingRow>
			</SettingsCard>

			<SettingsCard title={T.discover.title}>
				<SettingBlock
					label={T.discover.apiKeyLabel}
					hint={T.discover.apiKeyHint}
				>
					<Input
						type="password"
						value={wallhavenApiKey}
						onChange={(event) => setWallhavenApiKey(event.target.value)}
						placeholder={T.discover.apiKeyPlaceholder}
						autoComplete="off"
						spellCheck={false}
					/>
				</SettingBlock>
				<SettingBlock
					label={T.discover.pixabayApiKeyLabel}
					hint={T.discover.pixabayApiKeyHint}
				>
					<Input
						type="password"
						value={pixabayApiKey}
						onChange={(event) => setPixabayApiKey(event.target.value)}
						placeholder={T.discover.apiKeyPlaceholder}
						autoComplete="off"
						spellCheck={false}
					/>
				</SettingBlock>
				<SettingBlock
					label={T.discover.pexelsApiKeyLabel}
					hint={T.discover.pexelsApiKeyHint}
				>
					<Input
						type="password"
						value={pexelsApiKey}
						onChange={(event) => setPexelsApiKey(event.target.value)}
						placeholder={T.discover.apiKeyPlaceholder}
						autoComplete="off"
						spellCheck={false}
					/>
				</SettingBlock>
			</SettingsCard>
		</div>
	);
}

function CollectPane() {
	const { data: status } = useQuery(collectStatusQueryOptions());
	const { data: videoTool } = useQuery(videoToolStatusQueryOptions());
	const setEnabled = useSetCollectEnabled();
	const regenerate = useRegenerateCollectToken();
	const installTool = useInstallVideoTool();

	const copyToken = async () => {
		if (!status?.token) return;
		try {
			await navigator.clipboard.writeText(status.token);
			toast.success(T.collect.copied);
		} catch {
			toast.error(T.collect.copyFailed);
		}
	};

	return (
		<div className="flex flex-col gap-5">
			<SettingsCard title={T.collect.title}>
				<div className="px-4 py-3.5">
					<p className="text-muted-foreground text-xs leading-relaxed">
						{T.collect.description}
					</p>
				</div>
				<SettingRow
					label={T.collect.enable}
					description={
						status?.running && status.port != null
							? T.collect.runningOn(status.port)
							: T.collect.enableHint
					}
				>
					<Switch
						checked={status?.enabled ?? false}
						disabled={!status || setEnabled.isPending}
						onCheckedChange={(checked) => setEnabled.mutate(checked)}
					/>
				</SettingRow>
				{status?.enabled && status.token && (
					<SettingBlock label={T.collect.tokenLabel} hint={T.collect.tokenHint}>
						<div className="flex items-center gap-2">
							<Input
								readOnly
								value={status.token}
								className="font-mono text-xs"
								spellCheck={false}
								onFocus={(event) => event.currentTarget.select()}
							/>
							<Button
								variant="outline"
								size="sm"
								className="shrink-0"
								onClick={() => void copyToken()}
							>
								<IconCopy className="size-3.5" />
								{T.collect.copy}
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="shrink-0"
								disabled={regenerate.isPending}
								onClick={() => regenerate.mutate()}
							>
								<IconReload className="size-3.5" />
								{T.collect.regenerate}
							</Button>
						</div>
					</SettingBlock>
				)}
				<SettingRow
					label={T.collect.videoToolLabel}
					description={
						videoTool?.installed && videoTool.version
							? T.collect.videoToolVersion(videoTool.version)
							: T.collect.videoToolHint
					}
				>
					<Button
						variant="outline"
						size="sm"
						disabled={installTool.isPending}
						onClick={() => installTool.mutate()}
					>
						{installTool.isPending
							? T.collect.videoToolInstalling
							: videoTool?.installed
								? T.collect.videoToolUpdate
								: T.collect.videoToolInstall}
					</Button>
				</SettingRow>
			</SettingsCard>
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
		<SettingsCard title={T.preferences.navWatched}>
			<div className="flex flex-col gap-3 px-4 py-3.5">
				<p className="text-muted-foreground text-xs leading-relaxed">
					{T.watched.description}
				</p>
				{rows.length === 0 ? (
					<p className="py-2 text-muted-foreground text-sm">
						{T.watched.empty}
					</p>
				) : (
					<div className="flex flex-col gap-1.5">
						{rows.map((folder) => (
							<div
								key={folder.id}
								className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
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
						))}
					</div>
				)}
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
			</div>
		</SettingsCard>
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
		<SettingsCard title={T.preferences.navMaintenance}>
			<div className="flex flex-col gap-3 px-4 py-3.5">
				<p className="text-muted-foreground text-xs leading-relaxed">
					{T.maintenance.description}
				</p>
				<dl className="flex flex-col gap-2 text-sm">
					<div className="flex items-center justify-between">
						<dt>{T.maintenance.databaseSize}</dt>
						<dd className="text-muted-foreground tabular-nums">
							{report ? formatBytes(report.db_bytes ?? 0) : "—"}
						</dd>
					</div>
					<div className="flex items-center justify-between">
						<dt className="text-muted-foreground">
							{orphanCount > 0
								? T.maintenance.orphans(orphanCount)
								: T.maintenance.noOrphans}
						</dt>
					</div>
				</dl>
			</div>
			<div className="flex flex-wrap gap-2 px-4 py-3.5">
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
		</SettingsCard>
	);
}

/** A bordered, rounded group of settings with an optional header — the visual
 *  unit the Eagle-style pane is built from. */
function SettingsCard({
	title,
	children,
}: {
	title?: string;
	children: ReactNode;
}) {
	return (
		<section className="overflow-hidden rounded-xl border border-border/60 bg-background/30">
			{title && (
				<div className="border-b border-border/50 px-4 py-2.5">
					<h3 className="font-medium text-[13px] text-foreground/90">
						{title}
					</h3>
				</div>
			)}
			<div className="divide-y divide-border/40">{children}</div>
		</section>
	);
}

/** A label-left / control-right row inside a card. */
function SettingRow({
	label,
	description,
	children,
}: {
	label: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 px-4 py-3">
			<div className="min-w-0">
				<div className="text-sm">{label}</div>
				{description && (
					<p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
						{description}
					</p>
				)}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

/** A full-width stacked field (label ▸ control ▸ hint) inside a card. */
function SettingBlock({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5 px-4 py-3.5">
			<span className="text-sm">{label}</span>
			{children}
			{hint && (
				<p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
			)}
		</div>
	);
}

/** macOS-style segmented control for a small set of mutually exclusive options. */
function Segmented<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (value: T) => void;
	options: Array<{ value: T; label: string; icon?: ReactNode }>;
}) {
	return (
		<div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
			{options.map((opt) => {
				const active = opt.value === value;
				return (
					<button
						key={opt.value}
						type="button"
						aria-pressed={active}
						onClick={() => onChange(opt.value)}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-[0.4rem] px-2.5 py-1 text-sm transition-colors",
							active
								? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{opt.icon}
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}
