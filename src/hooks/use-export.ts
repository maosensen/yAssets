/**
 * Export flow: pick a destination directory, copy the given assets out under
 * their original names, toast the result. Shared by the inspector button,
 * the grid context menu, and the multi-select panel.
 */

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { commands } from "@/lib/bindings";
import { pickDirectory } from "@/lib/dialogs";
import { describeError } from "@/lib/errors";
import { unwrap } from "@/lib/tauri";
import { T } from "@/lib/text";

export function useExport() {
	const mutation = useMutation({
		mutationFn: async (input: { ids: string[]; dest: string }) =>
			unwrap(await commands.exportAssets(input.ids, input.dest)),
		onSuccess: (count) => toast.success(T.export.done(count)),
		onError: (error) => toast.error(describeError(error)),
	});

	/** Prompt for a directory, then export `ids` into it. */
	const exportAssets = async (ids: string[]) => {
		if (ids.length === 0) return;
		const dest = await pickDirectory(T.export.pickTitle);
		if (dest) mutation.mutate({ ids, dest });
	};

	return { exportAssets, isExporting: mutation.isPending };
}
