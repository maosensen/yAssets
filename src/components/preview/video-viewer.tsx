/**
 * Video preview — native <video> over the yasset:// protocol. Range support
 * (M0) makes seeking instant; WebKit/WebView2 decode mp4/mov/m4v/webm with
 * the system's own codecs, nothing ships on our side.
 *
 * Opening a video starts it playing: reaching this viewer is always an explicit
 * user action (double-click / Space / arrow-key navigation), which is the user
 * activation the engines' autoplay policies ask for — the preview is a route in
 * the same document, so that gesture carries over.
 */

import { useEffect, useRef } from "react";
import { fileUrl } from "@/lib/media";
import { useThumbSrc } from "@/lib/stores/cover-bust-store";

export function VideoViewer({
	assetId,
	name,
	hasThumb,
}: {
	assetId: string;
	name: string;
	hasThumb: boolean;
}) {
	// Cache-busted so a regenerated cover updates the poster too.
	const posterSrc = useThumbSrc(assetId);
	const videoRef = useRef<HTMLVideoElement>(null);

	// `autoPlay` alone is unreliable across WebKit/WebView2; kick playback off
	// explicitly too. If the policy still refuses (e.g. no user activation on a
	// restored deep link), stay paused — the controls are right there.
	useEffect(() => {
		videoRef.current?.play().catch(() => {
			/* autoplay refused — leave it paused, user can hit play */
		});
	}, []);

	return (
		<div className="flex h-full items-center justify-center p-6">
			{/* biome-ignore lint/a11y/useMediaCaption: arbitrary user video files have no caption tracks */}
			<video
				ref={videoRef}
				controls
				autoPlay
				preload="metadata"
				playsInline
				src={fileUrl(assetId)}
				poster={hasThumb ? posterSrc : undefined}
				title={name}
				className="max-h-full max-w-full rounded-md bg-black/40"
			/>
		</div>
	);
}
