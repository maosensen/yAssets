/**
 * Collect API data layer (Preferences ▸ Collect). The mutations return the
 * fresh status, so the cache is written directly instead of refetching.
 */

import {
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { commands } from "@/lib/bindings";
import { describeError } from "@/lib/errors";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";
import { collectKeys } from "./keys";

export function collectStatusQueryOptions() {
	return queryOptions({
		queryKey: collectKeys.status,
		queryFn: async () => unwrap(await commands.getCollectStatus()),
	});
}

export function useSetCollectEnabled() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (enabled: boolean) =>
			unwrap(await commands.setCollectEnabled(enabled)),
		onSuccess: (status) => {
			queryClient.setQueryData(collectKeys.status, status);
		},
		onError: (error) => toast.error(describeError(error)),
	});
}

export function useRegenerateCollectToken() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () => unwrap(await commands.regenerateCollectToken()),
		onSuccess: (status) => {
			queryClient.setQueryData(collectKeys.status, status);
			toast.success(T.collect.regenerated);
		},
		onError: (error) => toast.error(describeError(error)),
	});
}
