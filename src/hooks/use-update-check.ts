/**
 * Silent startup update check — once per launch, delayed so it never
 * competes with first paint. An available update raises a persistent toast
 * with an "Install & Restart" action; failures (dev builds, offline) log
 * quietly — Preferences ▸ Check for Updates remains the loud manual path.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { T } from "@/lib/text";
import { checkForUpdate, installAndRelaunch } from "@/lib/updater";

const STARTUP_DELAY_MS = 5_000;
const TOAST_ID = "app-update";

export function useUpdateCheck() {
	// Once per app session — survives StrictMode double-mount.
	const ran = useRef(false);

	useEffect(() => {
		if (ran.current) return;
		ran.current = true;

		const timer = window.setTimeout(() => {
			void (async () => {
				try {
					const update = await checkForUpdate();
					if (!update) return;
					toast(T.updates.available(update.version), {
						id: TOAST_ID,
						duration: Number.POSITIVE_INFINITY,
						action: {
							label: T.updates.installAction,
							onClick: () => {
								toast.loading(T.updates.installing, {
									id: TOAST_ID,
									duration: Number.POSITIVE_INFINITY,
								});
								installAndRelaunch(update).catch((error) => {
									logger.warn({ error }, "update install failed");
									toast.error(T.updates.failed, {
										id: TOAST_ID,
										duration: 6000,
									});
								});
							},
						},
					});
				} catch (error) {
					// Expected in dev builds / offline — stay silent.
					logger.info({ error }, "startup update check skipped");
				}
			})();
		}, STARTUP_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, []);
}
