/**
 * Inspector body when nothing is selected: what am I looking at + how many
 * assets it holds — rendered in the unified EmptyState language.
 */

import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { EmptyState } from "@/components/empty-state";
import {
	IconAll,
	type IconComponent,
	IconFolder,
	IconRecent,
	IconTag,
	IconTrash,
	IconUncategorized,
} from "@/components/icons";
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
		icon,
		title,
		count,
	}: { icon: IconComponent; title: string; count: number | undefined } =
		(() => {
			switch (search?.view) {
				case "folder": {
					const folder = folders?.find((f) => f.id === search?.folderId);
					return {
						icon: IconFolder,
						title: folder?.name ?? T.viewTitles.folderFallback,
						count: folder?.asset_count,
					};
				}
				case "tag": {
					const tag = tags?.find((t) => t.id === search?.tagId);
					return {
						icon: IconTag,
						title: tag?.name ?? T.viewTitles.tagFallback,
						count: tag?.asset_count,
					};
				}
				case "uncategorized":
					return {
						icon: IconUncategorized,
						title: T.viewTitles.uncategorized,
						count: stats?.uncategorized,
					};
				case "untagged":
					return {
						icon: IconTag,
						title: T.viewTitles.untagged,
						count: stats?.untagged,
					};
				case "recent":
					return {
						icon: IconRecent,
						title: T.viewTitles.recent,
						count: undefined,
					};
				case "trash":
					return {
						icon: IconTrash,
						title: T.viewTitles.trash,
						count: stats?.trash,
					};
				default:
					return {
						icon: IconAll,
						title: T.viewTitles.all,
						count: stats?.total,
					};
			}
		})();

	return (
		<EmptyState
			variant="panel"
			icon={icon}
			title={title}
			meta={count !== undefined ? T.inspector.itemCount(count) : undefined}
			hint={T.inspector.emptyHint}
		/>
	);
}
