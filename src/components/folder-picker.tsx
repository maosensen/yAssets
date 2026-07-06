/**
 * Folder picker — an Eagle-style command palette for toggling which folders an
 * asset (or a multi-selection) belongs to. Replaces the old add-only dropdown /
 * context submenu, which (1) didn't filter folders the asset was already in,
 * (2) had no scroll so deep trees overflowed, and (3) behaved differently in
 * the inspector vs the context menu.
 *
 * - Search (cmdk) filters by folder name; results render flat with a breadcrumb.
 * - Browsing shows the tree with indentation + expand/collapse chevrons and a
 *   Recent section on top.
 * - Each row is a checkbox: checked = the asset is in that folder; toggling
 *   adds/removes. The dialog stays open for multiple toggles.
 * - Typing a new name offers "Create folder …".
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { IconChevronRight, IconFolder, IconPlus } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	defaultFilter,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { Folder } from "@/lib/bindings";
import { buildFolderTree, flattenVisibleFolders } from "@/lib/folder-tree";
import {
	assetFolderMembershipQueryOptions,
	foldersQueryOptions,
	useAddAssetsToFolder,
	useCreateFolder,
	useRemoveAssetsFromFolder,
} from "@/lib/queries/folders";
import { useRecentFoldersStore } from "@/lib/stores/recent-folders-store";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

type FolderPickerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The asset(s) whose folder membership is being edited. */
	assetIds: string[];
};

export function FolderPicker({
	open,
	onOpenChange,
	assetIds,
}: FolderPickerProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="top-[12%] max-w-lg translate-y-0 gap-0 p-0"
			>
				<DialogHeader className="sr-only">
					<DialogTitle>{T.folderPicker.title}</DialogTitle>
					<DialogDescription>{T.folderPicker.description}</DialogDescription>
				</DialogHeader>
				{/* Remount per open so search/expand state resets. */}
				{open && <PickerBody assetIds={assetIds} />}
			</DialogContent>
		</Dialog>
	);
}

function PickerBody({ assetIds }: { assetIds: string[] }) {
	const { data: folders } = useQuery(foldersQueryOptions());
	const { data: memberList } = useQuery(
		assetFolderMembershipQueryOptions(assetIds),
	);
	const addMutation = useAddAssetsToFolder();
	const removeMutation = useRemoveAssetsFromFolder();
	const createMutation = useCreateFolder();
	const pushRecent = useRecentFoldersStore((state) => state.push);
	const recentIds = useRecentFoldersStore((state) => state.ids);

	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	const all = useMemo(() => folders ?? [], [folders]);
	const memberIds = useMemo(() => new Set(memberList ?? []), [memberList]);
	const roots = useMemo(() => buildFolderTree(all), [all]);
	const nameById = useMemo(
		() => new Map(all.map((folder) => [folder.id, folder.name])),
		[all],
	);
	const parentById = useMemo(
		() => new Map(all.map((folder) => [folder.id, folder.parent_id])),
		[all],
	);

	const searching = query.trim().length > 0;
	const rows = useMemo(
		() => flattenVisibleFolders(roots, expanded, searching),
		[roots, expanded, searching],
	);

	const breadcrumbOf = (id: string) => {
		const parent = parentById.get(id);
		return parent ? (nameById.get(parent) ?? null) : null;
	};

	const toggleExpand = (id: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const toggleMember = (id: string) => {
		if (memberIds.has(id)) {
			removeMutation.mutate({ assetIds, folderId: id });
		} else {
			addMutation.mutate({ assetIds, folderId: id });
			pushRecent(id);
		}
	};

	const trimmed = query.trim();
	const exactExists =
		trimmed !== "" &&
		all.some((folder) => folder.name.toLowerCase() === trimmed.toLowerCase());
	const recentNodes = recentIds
		.map((id) => all.find((folder) => folder.id === id))
		.filter((folder): folder is Folder => folder !== undefined);

	return (
		<Command
			className="rounded-lg bg-transparent"
			loop
			// Match on the folder NAME (keywords) only — the item value is the
			// folder id (a random nanoid), which would otherwise fuzzy-match and
			// surface unrelated folders for short queries.
			filter={(_value, search, keywords) => {
				const hay = keywords?.join(" ") ?? "";
				return hay ? defaultFilter(hay, search) : 0;
			}}
		>
			<CommandInput
				value={query}
				onValueChange={setQuery}
				placeholder={T.folderPicker.searchPlaceholder}
			/>
			<CommandList className="max-h-80">
				<CommandEmpty>{T.folderPicker.empty}</CommandEmpty>

				{!searching && recentNodes.length > 0 && (
					<CommandGroup heading={T.folderPicker.recent}>
						{recentNodes.map((folder) => (
							<FolderRow
								key={`recent:${folder.id}`}
								value={`recent:${folder.id}`}
								name={folder.name}
								depth={0}
								member={memberIds.has(folder.id)}
								breadcrumb={breadcrumbOf(folder.id)}
								onSelect={() => toggleMember(folder.id)}
							/>
						))}
					</CommandGroup>
				)}

				<CommandGroup heading={T.folderPicker.allFolders}>
					{rows.map(({ node, depth }) => (
						<FolderRow
							key={node.id}
							value={node.id}
							name={node.name}
							depth={searching ? 0 : depth}
							member={memberIds.has(node.id)}
							breadcrumb={breadcrumbOf(node.id)}
							hasChildren={node.children.length > 0 && !searching}
							expanded={expanded.has(node.id)}
							onToggleExpand={() => toggleExpand(node.id)}
							onSelect={() => toggleMember(node.id)}
						/>
					))}
				</CommandGroup>

				{trimmed !== "" && !exactExists && (
					<CommandGroup>
						<CommandItem
							value={`__create__${trimmed}`}
							keywords={[trimmed]}
							onSelect={() =>
								createMutation.mutate(
									{ name: trimmed },
									{
										onSuccess: (folder) => {
											addMutation.mutate({ assetIds, folderId: folder.id });
											pushRecent(folder.id);
											setQuery("");
										},
									},
								)
							}
						>
							<IconPlus className="size-4 text-muted-foreground" />
							<span className="min-w-0 flex-1 truncate">
								{T.folderPicker.create(trimmed)}
							</span>
						</CommandItem>
					</CommandGroup>
				)}
			</CommandList>

			<div className="flex items-center gap-4 border-t px-3 py-2 text-[11px] text-muted-foreground">
				<Hint keys="↑↓" label={T.folderPicker.kbMove} />
				<Hint keys="⏎" label={T.folderPicker.kbToggle} />
				<Hint keys="Esc" label={T.folderPicker.kbClose} />
			</div>
		</Command>
	);
}

type FolderRowProps = {
	value: string;
	name: string;
	depth: number;
	member: boolean;
	breadcrumb: string | null;
	hasChildren?: boolean;
	expanded?: boolean;
	onToggleExpand?: () => void;
	onSelect: () => void;
};

function FolderRow({
	value,
	name,
	depth,
	member,
	breadcrumb,
	hasChildren = false,
	expanded = false,
	onToggleExpand,
	onSelect,
}: FolderRowProps) {
	return (
		<CommandItem value={value} keywords={[name]} onSelect={onSelect}>
			<span style={{ width: depth * 14 }} className="shrink-0" aria-hidden />
			{hasChildren ? (
				<button
					type="button"
					tabIndex={-1}
					aria-label={expanded ? T.sidebar.collapse : T.sidebar.expand}
					className="flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						onToggleExpand?.();
					}}
				>
					<IconChevronRight
						className={cn(
							"size-3.5 text-muted-foreground transition-transform",
							expanded && "rotate-90",
						)}
					/>
				</button>
			) : (
				<span className="size-4 shrink-0" aria-hidden />
			)}
			<Checkbox
				checked={member}
				tabIndex={-1}
				className="pointer-events-none shrink-0"
			/>
			<IconFolder className="size-4 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate">{name}</span>
			{breadcrumb && (
				<span className="shrink-0 truncate text-muted-foreground text-xs">
					{breadcrumb}
				</span>
			)}
		</CommandItem>
	);
}

function Hint({ keys, label }: { keys: string; label: string }) {
	return (
		<span className="flex items-center gap-1.5">
			<kbd className="rounded border bg-muted px-1 py-0.5 font-medium text-[10px]">
				{keys}
			</kbd>
			{label}
		</span>
	);
}
