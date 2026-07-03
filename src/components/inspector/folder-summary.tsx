/**
 * Inspector body when nothing is selected: what am I looking at + how many
 * assets it holds.
 */

import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import {
	Clock,
	Folder as FolderIcon,
	Images,
	Inbox,
	Tag as TagIcon,
	Tags,
	Trash2,
} from "lucide-react";
import { foldersQueryOptions } from "@/lib/queries/folders";
import { libraryStatsQueryOptions } from "@/lib/queries/library";
import { tagsQueryOptions } from "@/lib/queries/tags";
import { T } from "@/lib/text";

export function FolderSummary() {
	// Also rendered under /preview (same layout) — fall back to "all".
	const search = useSearch({ from: "/_library/", shouldThrow: false });
	const { data: stats } = useQuery(libraryStatsQueryOptions());
	const { data: folders } = useQuery(foldersQueryOptions());
	const { data: tags } = useQuery(tagsQueryOptions());

	const {
		icon: Icon,
		title,
		count,
	} = (() => {
		switch (search?.view) {
			case "folder": {
				const folder = folders?.find((f) => f.id === search?.folderId);
				return {
					icon: FolderIcon,
					title: folder?.name ?? T.viewTitles.folderFallback,
					count: folder?.asset_count,
				};
			}
			case "tag": {
				const tag = tags?.find((t) => t.id === search?.tagId);
				return {
					icon: TagIcon,
					title: tag?.name ?? T.viewTitles.tagFallback,
					count: tag?.asset_count,
				};
			}
			case "uncategorized":
				return {
					icon: Inbox,
					title: T.viewTitles.uncategorized,
					count: stats?.uncategorized,
				};
			case "untagged":
				return {
					icon: Tags,
					title: T.viewTitles.untagged,
					count: stats?.untagged,
				};
			case "recent":
				return { icon: Clock, title: T.viewTitles.recent, count: undefined };
			case "trash":
				return {
					icon: Trash2,
					title: T.viewTitles.trash,
					count: stats?.trash,
				};
			default:
				return { icon: Images, title: T.viewTitles.all, count: stats?.total };
		}
	})();

	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-4">
			<Icon className="size-8 text-muted-foreground/50" />
			<p className="font-medium text-sm">{title}</p>
			{count !== undefined && (
				<p className="text-muted-foreground text-xs">
					{T.inspector.itemCount(count)}
				</p>
			)}
			<p className="mt-2 text-center text-muted-foreground text-xs">
				{T.inspector.emptyHint}
			</p>
		</div>
	);
}
