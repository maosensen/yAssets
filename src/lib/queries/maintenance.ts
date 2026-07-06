/**
 * Maintenance data layer (Preferences ▸ Maintenance): the report (db size +
 * orphan counts) plus vacuum / verify / clean-orphans actions.
 */

import {
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { commands } from "@/lib/bindings";
import { describeError } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";
import { libraryKeys, maintenanceKeys } from "./keys";

export function maintenanceReportQueryOptions() {
	return queryOptions({
		queryKey: maintenanceKeys.report,
		queryFn: async () => unwrap(await commands.getMaintenanceReport()),
	});
}

export function useVacuumDatabase() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () => unwrap(await commands.vacuumDatabase()),
		onSuccess: (reclaimed) => {
			toast.success(T.maintenance.vacuumDone(formatBytes(reclaimed ?? 0)));
			void queryClient.invalidateQueries({ queryKey: maintenanceKeys.report });
		},
		onError: (error) => toast.error(describeError(error)),
	});
}

export function useVerifyIntegrity() {
	return useMutation({
		mutationFn: async () => unwrap(await commands.verifyIntegrity()),
		onSuccess: (ok) => {
			if (ok) toast.success(T.maintenance.verifyOk);
			else toast.error(T.maintenance.verifyFailed);
		},
		onError: (error) => toast.error(describeError(error)),
	});
}

export function useCleanOrphans() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () => unwrap(await commands.cleanOrphans()),
		onSuccess: (result) => {
			toast.success(
				T.maintenance.cleanDone(result.asset_files + result.thumbnails),
			);
			void queryClient.invalidateQueries({ queryKey: maintenanceKeys.report });
			void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
		},
		onError: (error) => toast.error(describeError(error)),
	});
}
