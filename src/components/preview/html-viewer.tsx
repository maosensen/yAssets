/**
 * HTML preview — renders the imported document in a fully-sandboxed iframe over
 * the yasset:// protocol (Content-Type: text/html, recorded at import).
 *
 * SECURITY: imported HTML is untrusted. The parent CSP does NOT constrain the
 * framed yasset-origin document, and the protocol serves every asset with
 * `Access-Control-Allow-Origin: *` — so a script in the frame could fetch and
 * read OTHER assets by id. We therefore ship the most restrictive sandbox
 * (`sandbox=""`): no scripts, no forms, no popups, opaque origin. HTML + CSS +
 * images still render, which is all a preview needs; interactive/JS-driven
 * pages render static. Relative sub-resources won't resolve (files are copied
 * standalone). If interactive HTML is ever needed, that's a deliberate opt-in
 * that must first scope the protocol's CORS to the app origin.
 */

import { fileUrl } from "@/lib/media";

export function HtmlViewer({
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
			sandbox=""
			className="h-full w-full border-0 bg-white"
		/>
	);
}
