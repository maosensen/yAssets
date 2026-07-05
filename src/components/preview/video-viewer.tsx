/**
 * Video preview — native <video> over the yasset:// protocol. Range support
 * (M0) makes seeking instant; WebKit/WebView2 decode mp4/mov/m4v/webm with
 * the system's own codecs, nothing ships on our side.
 */

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
	return (
		<div className="flex h-full items-center justify-center p-6">
			{/* biome-ignore lint/a11y/useMediaCaption: arbitrary user video files have no caption tracks */}
			<video
				controls
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
