// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pan/zoom arithmetic — pure, DOM-free, and pinned by `transform.test.ts`.
 *
 * There is no runtime import in this file on purpose: `node --test` resolves
 * relative specifiers **literally**, so a value import of a sibling `.ts` would
 * need a `.ts` extension in the specifier. Keeping the maths self-contained
 * keeps the test line boring (`pnpm --filter=@workspace/ui test`); `types.ts` is
 * type-only and therefore erased before Node ever resolves it.
 *
 * Every function works on {@link ViewportTransform} values and viewport CSS
 * pixels. The one thing to keep straight while reading: `scale` grows around
 * `origin`, so a transform maps a viewport point `q` that the base occupied at
 * identity to
 *
 * ```text
 * M(q) = scale · q + (1 − scale) · origin + (x, y)
 * ```
 *
 * `origin` is the transformed element's own layout top-left — the element-local
 * `(0, 0)`, which is what `transform-origin: 0 0` pins down. All of the
 * derivation below is that one equation rearranged.
 */
import type {
  ViewportBounds,
  ViewportPoint,
  ViewportRect,
  ViewportTransform,
} from "./types";

export const IDENTITY_TRANSFORM: ViewportTransform = { scale: 1, x: 0, y: 0 };

/**
 * `1` is fit and is the floor: the base can never be shrunk below the size it
 * was laid out at, so "reset" and "zoomed all the way out" are the same state
 * and 恢复位置大小 always has somewhere unambiguous to land.
 */
export const MIN_VIEWPORT_SCALE = 1;

/** 8× is where a 1280px-wide photo has nothing left to reveal on a tablet. */
export const MAX_VIEWPORT_SCALE = 8;

/** Scale closer than this to `1` is "at fit". */
const SCALE_EPSILON = 0.001;

/** Translation closer than this to `0` is "not panned" (sub-pixel jitter). */
const PIXEL_EPSILON = 0.5;

export function clampScale(
  scale: number,
  min: number = MIN_VIEWPORT_SCALE,
  max: number = MAX_VIEWPORT_SCALE,
): number {
  if (!Number.isFinite(scale)) return min;
  const upper = Math.max(min, max);
  return Math.min(upper, Math.max(min, scale));
}

export function isIdentityTransform(
  transform: ViewportTransform,
  epsilon: number = SCALE_EPSILON,
): boolean {
  return (
    Math.abs(transform.scale - 1) <= epsilon &&
    Math.abs(transform.x) <= PIXEL_EPSILON &&
    Math.abs(transform.y) <= PIXEL_EPSILON
  );
}

/**
 * The CSS the host writes onto its base element. Must stay paired with
 * `transform-origin: 0 0` — the maths in this file assumes the element scales
 * about its own top-left, not about its centre.
 */
export function transformToCss(transform: ViewportTransform): string {
  return `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
}

/**
 * Where a rectangle that sat at `rect` (viewport coords, at identity) is painted
 * under `transform`.
 *
 * This is the single function that keeps the ink over the base: the host feeds
 * its `object-contain` rectangle in and hands the result to
 * the annotation layer as `getBaseRect()`, so both surfaces are literally the
 * same four numbers.
 */
export function applyTransform(
  rect: ViewportRect,
  transform: ViewportTransform,
  origin: ViewportPoint,
): ViewportRect {
  const offsetX = (1 - transform.scale) * origin.x + transform.x;
  const offsetY = (1 - transform.scale) * origin.y + transform.y;
  return {
    left: transform.scale * rect.left + offsetX,
    top: transform.scale * rect.top + offsetY,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale,
  };
}

export function panTransform(
  transform: ViewportTransform,
  dx: number,
  dy: number,
): ViewportTransform {
  if (!dx && !dy) return transform;
  return { scale: transform.scale, x: transform.x + dx, y: transform.y + dy };
}

/**
 * Scale by `factor` while the viewport point `pivot` stays where it is — the
 * "the pixel under my fingers does not move" rule a pinch is judged by.
 *
 * `factor <= 0` or non-finite returns the input unchanged: a degenerate pinch
 * (two fingers exactly on top of each other) must not produce `Infinity`.
 */
export function zoomAbout(
  transform: ViewportTransform,
  factor: number,
  pivot: ViewportPoint,
  origin: ViewportPoint,
): ViewportTransform {
  if (!Number.isFinite(factor) || factor <= 0) return transform;
  const scale = transform.scale * factor;
  if (!Number.isFinite(scale) || scale <= 0) return transform;
  return {
    scale,
    x: factor * transform.x + (1 - factor) * (pivot.x - origin.x),
    y: factor * transform.y + (1 - factor) * (pivot.y - origin.y),
  };
}

/** {@link zoomAbout}, but the caller knows the target scale instead of a ratio. */
export function scaleAbout(
  transform: ViewportTransform,
  scale: number,
  pivot: ViewportPoint,
  origin: ViewportPoint,
): ViewportTransform {
  if (transform.scale <= 0) return transform;
  return zoomAbout(transform, scale / transform.scale, pivot, origin);
}

/**
 * One frame of a pinch, **composed from the gesture's start transform** rather
 * than from the previous frame.
 *
 * `factor` is the ratio between the current finger spread and the spread when
 * the gesture (re)anchored; `from` is the midpoint at that anchor and `to` is
 * the midpoint now. Rebuilding from a fixed base every frame is what stops the
 * slow drift a delta-composed pinch accumulates, and moving `from` onto `to`
 * afterwards is what lets a two-finger drag pan while it zooms.
 */
export function pinchTransform(
  base: ViewportTransform,
  factor: number,
  from: ViewportPoint,
  to: ViewportPoint,
  origin: ViewportPoint,
): ViewportTransform {
  const zoomed = zoomAbout(base, factor, from, origin);
  return {
    scale: zoomed.scale,
    x: zoomed.x + (to.x - from.x),
    y: zoomed.y + (to.y - from.y),
  };
}

/**
 * Keep the base inside its viewport: cover the viewport when the scaled content
 * is larger, centre it on the axis where it is smaller, never let it be dragged
 * out of sight.
 *
 * The axis maths is the `M(q)` equation solved for `x`/`y`: the painted
 * position of the content with a zero translation is `base = scale·content +
 * (1 − scale)·origin`, so the painted box is `base + t` with extent
 * `content.size · scale`. Clamping that box to the viewport is then a plain
 * interval intersection.
 *
 * At `scale = 1` on a centred base this resolves to exactly `0`, which is why
 * `reset()` and the clamp agree instead of fighting: fit *is* the fixed point.
 */
export function clampTransform(
  transform: ViewportTransform,
  bounds: ViewportBounds,
  minScale: number = MIN_VIEWPORT_SCALE,
  maxScale: number = MAX_VIEWPORT_SCALE,
): ViewportTransform {
  // Fit is the CSS layout, by definition, and it is the one state the clamp must
  // never "correct": the host laid the base out itself (an `object-contain`
  // letterbox inside a padded box), and re-deriving that position from the clamp
  // viewport would shift it by any padding asymmetry. Passing the identity
  // through untouched also makes `reset()` exact rather than approximately exact.
  if (isIdentityTransform(transform)) return IDENTITY_TRANSFORM;

  const viewportCentre: ViewportPoint = {
    x: bounds.viewport.left + bounds.viewport.width / 2,
    y: bounds.viewport.top + bounds.viewport.height / 2,
  };
  const scale = clampScale(transform.scale, minScale, maxScale);
  // An out-of-range scale is pulled back about the viewport centre, so clamping
  // scale never also flings the content sideways.
  const sized =
    scale === transform.scale
      ? transform
      : scaleAbout(transform, scale, viewportCentre, bounds.origin);

  return {
    scale: sized.scale,
    x: clampAxis(sized.x, sized.scale, bounds, true),
    y: clampAxis(sized.y, sized.scale, bounds, false),
  };
}

function clampAxis(
  value: number,
  scale: number,
  bounds: ViewportBounds,
  horizontal: boolean,
): number {
  const content = horizontal ? bounds.content.left : bounds.content.top;
  const extent =
    (horizontal ? bounds.content.width : bounds.content.height) * scale;
  const viewStart = horizontal ? bounds.viewport.left : bounds.viewport.top;
  const viewSize = horizontal ? bounds.viewport.width : bounds.viewport.height;
  const origin = horizontal ? bounds.origin.x : bounds.origin.y;
  const base = scale * content + (1 - scale) * origin;

  if (extent >= viewSize) {
    const max = viewStart - base;
    const min = viewStart + viewSize - extent - base;
    return Math.min(max, Math.max(min, value));
  }
  // Smaller than the viewport on this axis: the only stable position is centred
  // (the base is centred at identity too, so this is continuous with `reset`).
  return viewStart + (viewSize - extent) / 2 - base;
}
