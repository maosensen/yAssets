/**
 * True when a pointer event's DOM target physically lives inside `container`.
 *
 * React portals bubble events through the REACT tree: a popup portaled to
 * document.body still fires its pointer events into React ancestors like the
 * grid's marquee handler. Surface-level press handlers (marquee selection,
 * pointer capture) must ignore those presses — capturing the pointer there
 * steals the popup item's pointerup/click and every menu action no-ops.
 */
export function pressWithin(
	container: Element,
	target: EventTarget | null,
): boolean {
	return target instanceof Node && container.contains(target);
}
