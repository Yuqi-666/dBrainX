// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared **viewport transform** — the one contract that lets a base surface
 * (an image today, a pdf page strip later) and the annotation layer painted on
 * top of it move as a single object.
 *
 * ## Why this lives outside `annotation/`
 *
 * "保证 annotation 和 image 在平移缩放中始终重叠一致" is not a rendering trick,
 * it is a *single source of truth* requirement: if the base and the ink each own
 * a pan/zoom, the two will drift the first time one of them clamps, rounds a
 * zoom step differently or resolves an anchor against another element's box. So
 * the host owns exactly one {@link ViewportTransform}, applies it to its base
 * (a CSS transform on the `<img>`) and hands the same object to
 * `<AnnotationLayer panZoom={controller} />`. The annotation layer never keeps
 * its own copy: it reads the *painted* rectangle the host derives from the
 * transform through its existing `getBaseRect()` callback, which is what makes
 * the overlap structural rather than coincidental.
 *
 * ## The coordinate space (read this before touching the maths)
 *
 * `x`/`y` are in **viewport CSS pixels** — the same space as `clientX/clientY`
 * and `getBoundingClientRect()`. `scale` multiplies around {@link
 * ViewportBounds.origin}, which is the transformed element's own layout top-left
 * (i.e. exactly what `transform-origin: 0 0` means for that element). The CSS
 * pair this maps onto is `translate3d(x, y, 0) scale(s)` with
 * `transform-origin: 0 0`; see `transformToCss`.
 *
 * Because the host renders the base with that CSS transform and computes the
 * annotation rectangle with {@link applyTransform} from the *same* numbers, the
 * two rectangles are equal by construction. No measuring the transformed DOM
 * twice, no chance of a one-frame disagreement.
 *
 * ## Extensibility (the pdf case)
 *
 * Nothing here knows what a base is. A pdf host would:
 *
 * 1. build a controller with `usePanZoom({ containerRef, getBounds })` whose
 *    `content`/`viewport` describe the page strip's box instead of a photo's
 *    letterboxed rectangle;
 * 2. render its pages with `transformToCss(transform)`;
 * 3. pass the same controller to `<AnnotationLayer panZoom={controller} />`
 *    and render `<PanZoomResetButton {...panZoom} />` beside it — the button
 *    needs nothing but the two values the hook returns.
 *
 * The gesture arbitration in `use-annotation-input.ts` is already pointer-type
 * driven (pen draws, fingers pan/pinch, two-finger tap undoes) and does not
 * mention images either, so a pdf host reuses it unchanged.
 */
import type { RefObject } from "react";

/**
 * Pan/zoom applied to one base surface.
 *
 * `scale` is a multiplier, so the identity (`1`) is "the base fits as it was
 * laid out" — which is exactly what 恢复位置大小 (单指双击 / the reset button)
 * restores.
 */
export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

/** A rectangle in viewport CSS pixels. Structurally a `BaseRect`. */
export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Everything the clamp and the zoom anchors need, measured fresh by the host.
 *
 * `content` is the base's painted rectangle **at identity** (for an image: the
 * `object-contain` letterbox arithmetic), `viewport` is the box the content is
 * kept inside (the scroll/clip container), and `origin` is the transformed
 * element's layout top-left — the point `scale` grows from.
 *
 * Deliberately returned by a *callback* rather than passed as props: a gesture
 * reads it on every frame, and re-measuring is the only honest answer after a
 * window resize, a sidebar toggle or a fit-mode change.
 */
export interface ViewportBounds {
  content: ViewportRect;
  viewport: ViewportRect;
  origin: ViewportPoint;
}

/**
 * The imperative handle a host shares with the annotation layer.
 *
 * Every method is safe to call at pointer rate: writes are clamped, coalesced
 * to one commit per animation frame, and read back through {@link
 * PanZoomController.current} so a burst of samples composes instead of each one
 * rebuilding from the last committed frame (the "swallowed notches" bug the pdf
 * viewer documents at its `zoomTargetRef`).
 */
export interface PanZoomController {
  /** The live transform — includes a frame's worth of not-yet-committed writes. */
  current(): ViewportTransform;
  /** Replace the transform (clamped, one commit per frame). */
  set(next: ViewportTransform): void;
  /** Translate by viewport CSS pixels. */
  panBy(dx: number, dy: number): void;
  /** Zoom by `factor` while keeping the viewport point under the cursor fixed. */
  zoomBy(factor: number, clientX: number, clientY: number): void;
  /**
   * One frame of a pinch: scale by `factor` about the frame's start point
   * (`fromX/fromY`) and move that point to where the fingers are now
   * (`toX/toY`). Composing it from the same `base` every frame is what keeps a
   * pinch from drifting — the graph package's `eventListener.ts` does the same
   * thing against its simulation coordinates.
   */
  pinch(
    base: ViewportTransform,
    factor: number,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): void;
  /**
   * Back to {@link IDENTITY_TRANSFORM} — 恢复位置大小. Reached from three places:
   * the single-finger double tap on the ink canvas, `PanZoomResetButton`, and the
   * layer's `0` key.
   */
  reset(): void;
  /** `true` when the view is not at fit. */
  isTransformed(): boolean;
}

export interface PanZoomOptions {
  /**
   * The element the wheel listener binds to (non-passive, because plain wheel
   * pans and ctrl/⌘-wheel zooms) and the element `ViewportBounds.viewport`
   * describes. It must be laid out before the first pointer arrives — a plain
   * `useRef` on the host's `relative` container.
   */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * Measure the clamp box and the scale origin, or `null` while the base is not
   * measurable (image not loaded, container collapsed). `null` disables clamping
   * for that call rather than freezing the view.
   */
  getBounds?: () => ViewportBounds | null;
  minScale?: number;
  maxScale?: number;
  /**
   * Whether the host has a base to drive right now. It gates the two things the
   * hook *binds* — the non-passive wheel listener and the resize observer — not
   * the controller: the mutators stay callable, the host simply has nothing to
   * call them from until the base exists.
   *
   * A host whose base appears late (an empty node that gets an image uploaded into
   * it) must flip this (`enabled: hasUrl`), because a ref that was `null` when the
   * effect first ran would otherwise leave the wheel unbound until a remount.
   */
  enabled?: boolean;
}

export interface PanZoom {
  /** The committed transform — what the host renders with. */
  transform: ViewportTransform;
  controller: PanZoomController;
}

/**
 * What `use-annotation-input.ts` needs to drive a shared viewport from the ink
 * canvas, which is the surface every pointer actually lands on.
 *
 * It is a bag rather than a set of callbacks on purpose: the recognizer must
 * consult `panEnabled` *before* deciding whether a finger draws or pans, and
 * the undo/redo taps belong to the layer that owns the history.
 */
export interface ViewportGestureOptions {
  /**
   * The host's transform, when it owns one.
   *
   * Optional because a host can own the viewport **elsewhere** and still want the
   * *arbitration*: a pdf page is a scroller, so its pan and pinch are recognised on
   * the scroller, but the ink canvas still has to reject a palm while the pen is
   * down, close a stroke when a second finger lands, and classify the two- and
   * three-finger taps. With no controller the machine does all of that and simply
   * has nothing to pan or zoom.
   */
  controller?: PanZoomController;
  /**
   * `false` while 手指=书写 is on: a single finger then draws, and only two or
   * more fingers pan/zoom (which is also when a stroke in flight is closed).
   */
  panEnabled: boolean;
  /** 双指轻点撤回. */
  onUndo?: () => void;
  /** 三指轻点重做. */
  onRedo?: () => void;
}
