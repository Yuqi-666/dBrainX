// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Whether `element` is currently shielded from pointer input by a modal layer
 * stacked above it — a dropdown, a popover, a select, or the host's own modal.
 *
 * Radix's `DismissableLayer` writes that shield **inline**: a dismissable layer
 * that is no longer the topmost one (`isPointerEventsEnabled === false`) gets
 * `style.pointerEvents = "none"`, and `document.body` gets the same value while
 * any layer with `disableOutsidePointerEvents` is mounted. The closest explicit
 * inline value on `element` or on one of its ancestors is therefore the layer
 * stack's verdict for that element — readable from any descendant, which is why
 * the check walks up instead of reading only `element` itself.
 *
 * Two surfaces ask the question, both because a layer that sits **below** an open
 * modal must not answer a gesture that the modal's own inner layer owns:
 *
 * - `components/ui/dialog.tsx` — `DialogOverlayImpl` hard-codes
 *   `pointer-events: auto`, so the click that dismisses an inner menu lands on the
 *   dialog overlay, reads as "outside the dialog", and would close the dialog too.
 * - `@workspace/editor`'s `FloatingElement` (the editor's floating toolbar) — its
 *   floating-ui dismissal is armed on `document`, so dismissing a dropdown opened
 *   from the toolbar would also close the toolbar and drop the text selection.
 *
 * Read it **synchronously at the start of a gesture** — a capture-phase
 * `pointerdown`/`keydown` listener. Once the inner layer has handled the gesture
 * it is dismissed and the shield is gone, so the same call then returns `false`;
 * that ordering is what makes the answer depend on the gesture rather than on
 * which library's document listener happens to run first.
 */
export function isShieldedByInnerLayer(
  element: HTMLElement | null | undefined,
): boolean {
  for (let node = element ?? null; node; node = node.parentElement) {
    const inline = node.style.pointerEvents;
    if (inline) return inline === "none";
  }
  return false;
}
