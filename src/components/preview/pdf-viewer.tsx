/**
 * PDF preview — the WebView's built-in renderer via an iframe pointed at
 * the yasset:// protocol (Content-Type: application/pdf + Range support).
 *
 * macOS WKWebView renders inline PDFs with PDFKit; Windows WebView2 uses
 * the Edge PDF viewer — both free, no pdf.js payload. CSP `frame-src` lists
 * the yasset origins. If an engine ever refuses inline rendering, the
 * fallback plan is pdf.js behind this same component boundary.
 */

import { fileUrl } from "@/lib/media";

export function PdfViewer({
	assetId,
	name,
}: {
	assetId: string;
	name: string;
}) {
	return (
		<iframe
			src={fileUrl(assetId)}
			title={name}
			className="h-full w-full border-0 bg-muted/20"
		/>
	);
}
