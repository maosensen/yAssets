/**
 * Audio preview — native <audio> controls over the yasset:// protocol.
 * Range support (M0) makes seeking work; WebKit decodes mp3/m4a/aac/wav/
 * flac/aiff natively, so there's no decoding on our side at all.
 */

import { IconMusic } from "@/components/icons";
import { fileUrl } from "@/lib/media";

export function AudioViewer({
	assetId,
	name,
}: {
	assetId: string;
	name: string;
}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-6 p-8">
			<div className="flex size-24 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/40 text-muted-foreground/70">
				<IconMusic className="size-10" />
			</div>
			<span className="max-w-md truncate font-medium text-sm">{name}</span>
			{/* biome-ignore lint/a11y/useMediaCaption: arbitrary user audio files have no caption tracks */}
			<audio
				controls
				preload="metadata"
				src={fileUrl(assetId)}
				className="w-full max-w-md"
			/>
		</div>
	);
}
