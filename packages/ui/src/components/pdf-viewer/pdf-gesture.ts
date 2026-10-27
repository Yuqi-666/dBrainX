// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pdf's own viewport gestures, as **pure decisions** — the counterpart of
 * `pan-zoom/recognizer.ts` for a host whose fit is not a CSS transform.
 *
 * A pdf page strip is a scroller, not a transformed element: `effectiveScale` is a
 * page-box multiplier the viewer lays out with, and the position is the scroller's
 * offset. So the image host's `ViewportTransform` does not describe it, and the
 * gestures are composed here instead:
 *
 * - **平移** is a scroll (`scrollTop -= dy`), which the viewer does directly — a
 *   finger that tracks the page 1:1 needs no maths.
 * - **缩放** is a pinch: the multiplier follows the finger *spread*, and the
 *   content point under the fingers is kept under them by the viewer's existing
 *   anchor (`anchorScroll` + `applyZoom`), which is the same machinery ⌘-wheel
 *   zoom already uses.
 * - **双击恢复位置大小** returns to the view the document opened at.
 *
 * What lives here is only the part with a number in it — the ratio, the two
 * deltas, the "is the reader still where they started" test — because those are
 * the pieces a gesture layer gets subtly wrong (a division by a collapsed pinch, a
 * pan applied in the wrong direction, a reset that cannot be reached). They are
 * pinned by `pdf-gesture.test.ts` with `node --test`.
 *
 * Like `draw.ts`, this module deliberately avoids runtime imports of its
 * siblings: `node --test` resolves relative specifiers literally, so `scale.ts`'s
 * clamp is re-stated here rather than imported through a `.ts` path. The pdf
 * viewer's own limits are the same numbers `types.ts` publishes, and the test
 * pins the behaviour rather than the constant.
 */

/** The narrowest / widest multiplier the viewer paints at (`PDF_MIN_SCALE`/`MAX`). */
const MIN_SCALE = 0.25;
const MAX_SCALE = 6;

/** Two multipliers closer than this are the same multiplier. */
const SCALE_EPSILON = 0.001;

function clampScale(scale: number, min = MIN_SCALE, max = MAX_SCALE): number {
  if (!Number.isFinite(scale)) return min;
  const upper = Math.max(min, max);
  return Math.min(upper, Math.max(min, scale));
}

/**
 * How the view looked when the fingers last (re)anchored — the snapshot a frame is
 * composed from.
 *
 * The scroller's offset is part of it, and that is what makes a frame **absolute**:
 * a frame is `anchor → now`, so the offset it returns is the one the anchor had,
 * moved by the fingers. Applying a frame is therefore an assignment, never an
 * accumulation — see {@link PdfPinchFrame}.
 */
export interface PdfPinchAnchor {
  /** The multiplier at the anchor. */
  scale: number;
  /** Mean distance from the fingers' centroid at the anchor, in CSS px. */
  spread: number;
  /** The centroid at the anchor, in client (viewport) coordinates. */
  midX: number;
  midY: number;
  /** The scroller's offset at the anchor. */
  scrollLeft: number;
  scrollTop: number;
}

/** Where the scroller's viewport starts, in client coordinates. */
export interface PdfViewportOrigin {
  x: number;
  y: number;
}

/**
 * One frame of a pinch: the multiplier **and** the scroller offset to set.
 *
 * Both numbers are absolute, and that is deliberate. A pinch delivers a burst of
 * samples and the caller must be able to apply each one without remembering the
 * previous: a frame expressed as a *delta* would have to be added to the offset
 * the last frame wrote, and the first reader to add it to the offset the *anchor*
 * recorded would scroll by the running total, once per sample (a two-finger drag
 * of 100px becoming thousands of pixels of travel). So the caller assigns:
 *
 * ```ts
 * element.scrollLeft = frame.scrollLeft;
 * element.scrollTop = frame.scrollTop;
 * ```
 */
export interface PdfPinchFrame {
  /** The multiplier to zoom to. */
  scale: number;
  /** The scroller's horizontal offset for this frame. */
  scrollLeft: number;
  /** The scroller's vertical offset for this frame. */
  scrollTop: number;
}

/**
 * One frame of a pinch, or `null` when the gesture carries no information yet.
 *
 * `null` is returned for a degenerate pinch — two fingers exactly on top of each
 * other, which makes the spread ratio `Infinity` — and for a non-finite input.
 * A caller that applied such a frame would divide by zero and leave the document
 * at an unusable zoom, so "nothing to do" is the only safe answer.
 *
 * The offset follows the *centroid*, not one finger: dragging two fingers sideways
 * scrolls the document while keeping the zoom, and adding or lifting a finger
 * mid-gesture only re-anchors (the caller re-reads {@link PdfPinchAnchor}), so the
 * frame never jumps.
 */
export function pdfPinchFrame(
  anchor: PdfPinchAnchor,
  current: { spread: number; midX: number; midY: number },
  origin: PdfViewportOrigin,
): PdfPinchFrame | null {
  const { scale, spread, midX, midY, scrollLeft, scrollTop } = anchor;
  if (
    !Number.isFinite(scale) ||
    !Number.isFinite(spread) ||
    !Number.isFinite(current.spread) ||
    spread <= 0 ||
    current.spread <= 0 ||
    !Number.isFinite(current.midX) ||
    !Number.isFinite(current.midY) ||
    !Number.isFinite(midX) ||
    !Number.isFinite(midY) ||
    !Number.isFinite(scrollLeft) ||
    !Number.isFinite(scrollTop) ||
    !Number.isFinite(origin.x) ||
    !Number.isFinite(origin.y)
  ) {
    return null;
  }

  const next = clampScale(scale * (current.spread / spread));
  const ratio = next / scale;
  /**
   * The whole frame is **the anchored content point, kept under the fingers**.
   *
   * The offset the fingers see is `client - viewportOrigin`, and the content
   * coordinate under them is `scroll + offset` — in the layout that exists at
   * `scale`. Scaling the content by `ratio` puts that same point at
   * `(scroll + offset) · ratio`, so the offset that keeps it under the fingers is
   * that, minus where the fingers are now:
   *
   * ```text
   * scroll' = (scroll + offsetAnchor) · ratio − offsetNow
   * ```
   *
   * Doing it in *one* expression is the point. A frame that returned only the
   * midpoint's travel (`mid - midAnchor`) would be pan in the anchor's coordinate
   * space, and the caller's own zoom anchor — which works from the *current*
   * layout's offset — would then re-scale the wrong number: the page slides out
   * from under the fingers by the accumulated `scale / anchorScale` factor.
   *
   * `ratio === 1` (a pure two-finger drag) reduces to `scroll − Δmid`: the content
   * follows the midpoint exactly, with no zoom involved.
   */
  const offsetAnchorX = midX - origin.x;
  const offsetAnchorY = midY - origin.y;
  const offsetNowX = current.midX - origin.x;
  const offsetNowY = current.midY - origin.y;
  return {
    scale: next,
    scrollLeft: (scrollLeft + offsetAnchorX) * ratio - offsetNowX,
    scrollTop: (scrollTop + offsetAnchorY) * ratio - offsetNowY,
  };
}

/**
 * Is the reader still at the view the document opened at?
 *
 * Drives the pdf's 恢复位置大小 pill: the transform hosts ask
 * `isIdentityTransform`, and this is the same question for a scroller.
 *
 * Purely numeric, against the multiplier the **opening view resolves to right
 * now** (`resolveFitScale(opening.fit)`, which the caller knows because it owns the
 * viewport): 适配宽度 at a wider window is still 适配宽度, so a resize must not
 * summon the pill, and picking the same multiplier from the toolbar's scale list
 * must not either. Comparing fit *modes* would get both of those wrong in opposite
 * directions — the size the reader sees is what the button restores.
 *
 * A `free` opening view has no fit mode to resolve (its number is the whole view),
 * so `opening.scale` is the target instead.
 */
export function pdfIsInitialView(
  scale: number,
  opening: { scale: number; fit: string },
  /** What `opening.fit` resolves to for the current viewport. */
  resolvedScale: number,
): boolean {
  const target = opening.fit === "free" ? opening.scale : resolvedScale;
  return Math.abs(scale - target) <= SCALE_EPSILON;
}
