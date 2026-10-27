// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * An interaction layer that lives in `document.body`.
 *
 * Canvas-backed views have no DOM node to hang a Radix trigger off, so they
 * render an invisible `position: fixed` box at the rect the library reported and
 * let the primitive anchor to it (the table's anchored menus, the calendar's and
 * the gantt's hover readouts, the record menu at a point).
 *
 * That box **must** be portalled, not merely `position: fixed`: a transformed
 * ancestor becomes the containing block of a fixed element, and the node content
 * is routinely mounted inside the node editor's `DialogContent`, which is centred
 * with a permanent `-translate-x-1/2 -translate-y-1/2` (Tailwind v4 writes the
 * standalone `translate` property, which establishes that containing block just
 * like `transform` does). `left`/`top` are then measured from the dialog panel
 * instead of the viewport — every anchored layer lands down-right of the pointer
 * by the dialog's own page offset (measured: the panel sat at `128, 63`, and a
 * fixed box at `100, 100` inside it rendered at `228, 163`). Radix portals its own
 * *content* to the body; this portals the anchor with it, so both ends share the
 * viewport's coordinate space.
 *
 * The portal wraps the **whole primitive**. It must not sit *inside* the
 * primitive's `asChild` trigger instead: `asChild` clones its immediate child,
 * and `React.isValidElement` is false for a portal object, so
 * `<Trigger asChild>{createPortal(<span />, body)}</Trigger>` renders nothing at
 * all and leaves Floating UI measuring `null` (the panel then falls back to the
 * viewport origin). The table's anchored menus portal the trigger the same way
 * this portals the tooltip.
 *
 * Rendering is deferred to the client by the interaction that opens the layer
 * (a hover, a right-click), so there is no server pass to disagree with.
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function BodyLayer({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
