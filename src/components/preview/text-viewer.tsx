/**
 * Text / Markdown preview. Content is fetched over the yasset:// protocol
 * with a Range header, so only the first 1 MB ever crosses into the WebView —
 * bigger files show a truncation notice (total size read from Content-Range).
 *
 * Markdown renders through react-markdown (no raw HTML execution) + GFM;
 * everything else is a monospace <pre>. Content is immutable (id-addressed),
 * so the query never goes stale.
 */

import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyState } from "@/components/empty-state";
import { IconFileText } from "@/components/icons";
import { fileUrl } from "@/lib/media";
import { T } from "@/lib/text";

const MAX_BYTES = 1024 * 1024;

type TextContent = { text: string; truncated: boolean };

async function fetchText(assetId: string): Promise<TextContent> {
	const response = await fetch(fileUrl(assetId), {
		headers: { Range: `bytes=0-${MAX_BYTES - 1}` },
	});
	if (!response.ok) {
		throw new Error(`file fetch failed: ${response.status}`);
	}
	const text = await response.text();
	// 206 + Content-Range "bytes 0-N/total" → truncated when total > window.
	const total = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
	const truncated = total !== undefined && Number(total) > MAX_BYTES;
	return { text, truncated };
}

export function TextViewer({
	assetId,
	markdown,
}: {
	assetId: string;
	markdown: boolean;
}) {
	const { data, isError } = useQuery({
		queryKey: ["assets", "text", assetId],
		queryFn: () => fetchText(assetId),
		staleTime: Number.POSITIVE_INFINITY,
	});

	if (isError) {
		return (
			<EmptyState
				variant="panel"
				icon={IconFileText}
				tone="destructive"
				title={T.preview.textError}
			/>
		);
	}
	if (!data) {
		return (
			<div className="flex h-full items-center justify-center">
				<span className="text-muted-foreground text-sm">
					{T.common.loading}
				</span>
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			{data.truncated && (
				<div className="sticky top-0 border-b bg-muted/80 px-4 py-1.5 text-center text-muted-foreground text-xs backdrop-blur">
					{T.preview.textTruncated}
				</div>
			)}
			<div className="mx-auto max-w-3xl px-8 py-6">
				{markdown ? (
					<article className="prose prose-sm dark:prose-invert">
						<Markdown remarkPlugins={[remarkGfm]}>{data.text}</Markdown>
					</article>
				) : (
					<pre className="whitespace-pre-wrap break-words font-mono text-foreground/90 text-xs leading-relaxed">
						{data.text}
					</pre>
				)}
			</div>
		</div>
	);
}
