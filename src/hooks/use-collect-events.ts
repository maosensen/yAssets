/**
 * Captures arriving through the Collect API (yClip browser extension) bypass
 * the frontend mutation layer entirely — the Rust server imports and then
 * emits `CollectImported`. This hook (mounted once in AppShell) toasts the
 * arrival and refreshes the asset lists so the grid shows it immediately.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { events } from "@/lib/bindings";
import { assetKeys, libraryKeys } from "@/lib/queries/keys";
import { T } from "@/lib/text";

export function useCollectEvents() {
	const queryClient = useQueryClient();

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		void events.collectImported
			.listen((event) => {
				const { title, duplicate } = event.payload;
				if (duplicate) {
					// Nothing new in the library — inform, don't refetch.
					toast.info(T.collect.toastDuplicate(title));
					return;
				}
				toast.success(T.collect.toastSaved(title));
				void queryClient.invalidateQueries({ queryKey: assetKeys.all });
				void queryClient.invalidateQueries({ queryKey: libraryKeys.stats });
			})
			.then((fn) => {
				if (disposed) fn();
				else unlisten = fn;
			});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [queryClient]);
}
