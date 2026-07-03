/**
 * Pending duplicate-import decisions (drives the Duplicate Alert dialog).
 *
 * The import pipeline reports library-wide exact duplicates in its terminal
 * `ImportFinished` event. Because the event doesn't echo the job's target
 * folder, `useImport` registers job → folder here at start time; when the
 * finish event carries duplicates, `raise` joins the two and the dialog
 * (mounted in AppShell) opens. "Keep both" re-imports into that same folder.
 */

import { create } from "zustand";
import type { DuplicateItem } from "@/lib/bindings";

type PendingDuplicates = {
	jobId: string;
	folderId: string | null;
	items: DuplicateItem[];
};

type DuplicatesState = {
	pending: PendingDuplicates | null;
	/** job_id → target folder, captured when the job starts. */
	folderByJob: Record<string, string | null>;
	registerJob: (jobId: string, folderId: string | null) => void;
	/** Surface a finished job's duplicates (consumes the folder mapping). */
	raise: (jobId: string, items: DuplicateItem[]) => void;
	/** Drop the mapping for a job that finished clean. */
	forget: (jobId: string) => void;
	clear: () => void;
};

export const useDuplicatesStore = create<DuplicatesState>()((set) => ({
	pending: null,
	folderByJob: {},
	registerJob: (jobId, folderId) =>
		set((state) => ({
			folderByJob: { ...state.folderByJob, [jobId]: folderId },
		})),
	raise: (jobId, items) =>
		set((state) => {
			const { [jobId]: folderId = null, ...rest } = state.folderByJob;
			return { pending: { jobId, folderId, items }, folderByJob: rest };
		}),
	forget: (jobId) =>
		set((state) => {
			const { [jobId]: _dropped, ...rest } = state.folderByJob;
			return { folderByJob: rest };
		}),
	clear: () => set({ pending: null }),
}));
