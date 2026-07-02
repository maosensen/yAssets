/**
 * Shared open/create/close library flows — used by both the welcome screen
 * and the sidebar library switcher so the cache + navigation choreography
 * lives in exactly one place.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { pickDirectory } from "@/lib/dialogs";
import { describeError } from "@/lib/errors";
import {
	applyLibraryClosed,
	applyLibrarySwitched,
	closeLibrary,
	createLibraryAt,
	openLibraryAt,
} from "@/lib/queries/library";
import { T } from "@/lib/text";

export function useLibraryActions() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const enterLibrary = async (
		info: Parameters<typeof applyLibrarySwitched>[1],
	) => {
		await applyLibrarySwitched(queryClient, info);
		void navigate({ to: "/", search: { view: "all" }, replace: true });
	};

	const openMutation = useMutation({
		mutationFn: openLibraryAt,
		// Returning the promise keeps the mutation pending (buttons disabled)
		// until the cache handover to the new library has completed.
		onSuccess: (info) => enterLibrary(info),
		onError: (error) => toast.error(describeError(error)),
	});

	const createMutation = useMutation({
		mutationFn: createLibraryAt,
		onSuccess: (info) => enterLibrary(info),
		onError: (error) => toast.error(describeError(error)),
	});

	const closeMutation = useMutation({
		mutationFn: closeLibrary,
		onSuccess: async () => {
			await applyLibraryClosed(queryClient);
			void navigate({ to: "/welcome", replace: true });
		},
		onError: (error) => toast.error(describeError(error)),
	});

	/** Pick an (empty) folder and create a library in it. */
	const pickAndCreate = async () => {
		const dir = await pickDirectory(T.welcome.pickCreateTitle);
		if (dir) createMutation.mutate(dir);
	};

	/** Pick an existing library folder and open it. */
	const pickAndOpen = async () => {
		const dir = await pickDirectory(T.welcome.pickOpenTitle);
		if (dir) openMutation.mutate(dir);
	};

	/** Open a known library path (recent list entries). */
	const openPath = (path: string) => openMutation.mutate(path);

	return {
		pickAndCreate,
		pickAndOpen,
		openPath,
		closeCurrent: () => closeMutation.mutate(),
		busy:
			openMutation.isPending ||
			createMutation.isPending ||
			closeMutation.isPending,
	};
}
