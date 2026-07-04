/**
 * Smart-folder data layer: list query + CRUD mutations.
 *
 * Rule edits change what the smart view *contains*, so mutations invalidate
 * the asset lists too — a smart folder has no membership rows to patch.
 */

import {
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { commands, type SmartRules } from "@/lib/bindings";
import { describeError } from "@/lib/errors";
import { unwrap } from "@/lib/tauri";
import { assetKeys, smartFolderKeys } from "./keys";

export function smartFoldersQueryOptions() {
	return queryOptions({
		queryKey: smartFolderKeys.all,
		queryFn: async () => unwrap(await commands.listSmartFolders()),
	});
}

function useSmartFolderMutation<TInput>(
	mutationFn: (input: TInput) => Promise<unknown>,
) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: smartFolderKeys.all });
			void queryClient.invalidateQueries({ queryKey: assetKeys.all });
		},
		onError: (error) => toast.error(describeError(error)),
	});
}

export function useCreateSmartFolder() {
	return useSmartFolderMutation(
		async (input: { name: string; rules: SmartRules }) =>
			unwrap(await commands.createSmartFolder(input.name, input.rules)),
	);
}

export function useUpdateSmartFolder() {
	return useSmartFolderMutation(
		async (input: { id: string; name?: string; rules?: SmartRules }) =>
			unwrap(
				await commands.updateSmartFolder(
					input.id,
					input.name ?? null,
					input.rules ?? null,
				),
			),
	);
}

export function useDeleteSmartFolder() {
	return useSmartFolderMutation(async (id: string) =>
		unwrap(await commands.deleteSmartFolder(id)),
	);
}
