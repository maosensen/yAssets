/**
 * Observe an element's content width (ResizeObserver, rAF-coalesced).
 * Drives masonry re-layout on panel resize / window resize.
 */

import { type RefObject, useEffect, useState } from "react";

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState(0);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		let frame = 0;
		const update = () => {
			frame = 0;
			setWidth(element.clientWidth);
		};
		update();

		const observer = new ResizeObserver(() => {
			if (frame === 0) frame = requestAnimationFrame(update);
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	}, [ref]);

	return width;
}
