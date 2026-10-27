// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The annotation layer's geometry — pure, DOM-free, and pinned by
 * `geometry.test.ts` (`pnpm --filter=@workspace/ui test`).
 *
 * Everything here works in **normalized coordinates**: `(u, v) ∈ [0,1]²` relative
 * to the base image's *drawn* rectangle (design §0.2-②). That is the only reason a
 * mark survives a window resize, a device change or a DPR change — so `rect` is
 * always passed **into** a function, never captured, and the stored data never
 * learns how big anything was on screen.
 *
 * Two invariants from design §3.1 are enforced here rather than trusted to the
 * caller:
 *
 * 1. a stored `bbox` is **inflated** ({@link itemBBox}) — `perfect-freehand`'s
 *    outline overshoots its sampled points, and a tight box makes both the hit
 *    test and the dirty rect miss;
 * 2. image items have `page === undefined` and pdf items have a page — that is a
 *    P1 concern, but this module returns the un-modified item so M7 can layer the
 *    page/rotation matrix on top without re-deriving anything (plan §7.2-1).
 *
 * **This is a one-shot interface.** M7 rewrites the coordinate chain to
 * `(rect + pageIndex + rotation matrix)` (design §6 last line), so treat the
 * signatures below as frozen for P0 only.
 */
import type { Annotation, AnnotationPoint } from "@workspace/interfaces";

import type { BaseRect, LayerBox } from "./types";

/**
 * How far a persisted point must be from the previously kept one before it is
 * kept (design §3.2: "抽稀只在持久化前做", suggested 0.002).
 *
 * Only persistence is thinned — rendering always uses the sampled points as they
 * arrived — and the acceptance criterion is that a simplified stroke redraws
 * identically to the eye (G5 #4).
 *
 * It lives here rather than in `types.ts` on purpose: this module is executed by
 * `node --test`, which resolves relative imports **literally**, so a value import
 * of a sibling `.ts` file would need a `.ts` extension in the specifier. Keeping
 * the pure modules free of runtime imports keeps the test line boring.
 */
export const SIMPLIFY_EPSILON = 0.002;

/**
 * Extra margin added to a stored `bbox` on top of `size / 2` (design §3.1
 * invariant 2). `perfect-freehand`'s outline overshoots the sampled points, and a
 * tight box makes both the hit test and the dirty rect miss. Over-inflating is
 * harmless (the bbox is only a prefilter), so this is a fixed normalized pad
 * rather than a ratio that would need the rectangle's aspect ratio.
 */
export const BBOX_MARGIN = 0.004;

/** `[x0, y0, x1, y1]`, normalized. */
export type BBox = [number, number, number, number];

/** The safe identity for "outside the layer": store `[0,1]²` only. */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * The rectangle an `object-contain` image actually paints into, given the box it
 * was given (design §3.4's `containRect`).
 *
 * The browser will not tell us this: the letterbox is produced by CSS, and
 * `getBoundingClientRect()` on the `<img>` returns the *element's* box. So the
 * host measures its own content box, the natural size comes from the loaded
 * image, and this is the arithmetic in between.
 *
 * An unloaded image (`naturalWidth === 0`) or a collapsed container returns the
 * container itself rather than a zero-size rectangle, so callers get a usable
 * (if meaningless) box instead of a division by zero.
 */
export function containRect(
  container: BaseRect,
  naturalWidth: number,
  naturalHeight: number,
): BaseRect {
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return { ...container };
  }

  const aspect = naturalWidth / naturalHeight;
  const boxAspect = container.width / container.height;
  const width =
    aspect > boxAspect ? container.width : container.height * aspect;
  const height =
    aspect > boxAspect ? container.width / aspect : container.height;

  return {
    left: container.left + (container.width - width) / 2,
    top: container.top + (container.height - height) / 2,
    width,
    height,
  };
}

/**
 * One measured viewport size ÷ the same size in layout pixels = the scale the
 * whole subtree is currently painted at. `1` when either half is unusable.
 */
function axisScale(measured: number, layout: number): number {
  if (
    !Number.isFinite(measured) ||
    !Number.isFinite(layout) ||
    measured <= 0 ||
    layout <= 0
  ) {
    return 1;
  }
  return measured / layout;
}

/**
 * A viewport measurement → the layer root's **own layout space**.
 *
 * `getBoundingClientRect()` reports *painted* pixels, so any ancestor transform is
 * baked into it — and the node editor's Dialog opens with `zoom-in-95`, i.e. a
 * 100 ms scale from 0.95 to 1 over the whole subtree. A measurement taken inside
 * that window is ~5% small in **both** axes; `ResizeObserver` then never corrects
 * it, because a transform is not a layout change. The result was reported at G5:
 * the ink area is a scaled-down rectangle anchored near the image's top-left, and
 * it does not grow when the animation ends.
 *
 * The root's `offsetWidth`/`offsetHeight` are layout pixels, so their ratio to the
 * measured rect *is* that accumulated scale. Dividing the measurement by it puts
 * every number back into the space the canvas element is laid out in — and since
 * the canvas is a child of the same transformed subtree, both are then scaled
 * together at every moment, so the correction is exact **during** the animation
 * too, not just after it.
 *
 * The axes are corrected separately so a non-uniform animation (`scale(sx, sy)`)
 * is handled as well as a uniform one. `offsetWidth` is an integer, so the scale
 * carries up to ~0.5px of rounding over the root's width — sub-pixel in the box.
 */
export function toLayerBox(
  rect: BaseRect,
  origin: BaseRect,
  layout: { width: number; height: number },
): LayerBox {
  const scaleX = axisScale(origin.width, layout.width);
  const scaleY = axisScale(origin.height, layout.height);
  return {
    left: (rect.left - origin.left) / scaleX,
    top: (rect.top - origin.top) / scaleY,
    width: rect.width / scaleX,
    height: rect.height / scaleY,
  };
}

/**
 * Viewport point → normalized storage point (design §3.4 step 2).
 *
 * Out-of-rect samples are **clamped**, not rejected: a stroke that grazes the
 * edge should keep the part that is on the image, and a clamped point is a far
 * better artefact than a dropped one.
 */
export function normalizePoint(
  rect: BaseRect,
  clientX: number,
  clientY: number,
): AnnotationPoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/** Normalized storage point → viewport point (the drawing direction). */
export function toDisplayPoint(
  rect: BaseRect,
  point: AnnotationPoint,
): { x: number; y: number } {
  return {
    x: rect.left + point.x * rect.width,
    y: rect.top + point.y * rect.height,
  };
}

/**
 * A stored `size` is a fraction of the base image's **short edge** (design §0.2-②);
 * rendering and hit-testing need pixels, so this is the single conversion between
 * the two. Stroke weight therefore follows the image, not the window.
 */
export function toDisplaySize(size: number, rect: BaseRect): number {
  return size * Math.min(rect.width, rect.height);
}

/** Inverse of {@link toDisplaySize}. */
export function toNormalizedSize(pixels: number, rect: BaseRect): number {
  const shortEdge = Math.min(rect.width, rect.height);
  return shortEdge > 0 ? pixels / shortEdge : 0;
}

export function distance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Shortest distance from a point to the segment `a → b` (design §3.3 整笔擦除). */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(px, py, ax, ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return distance(px, py, ax + t * dx, ay + t * dy);
}

/** The tight box around a point list, or `null` when there is nothing to box. */
export function pointsBBox(points: readonly AnnotationPoint[]): BBox | null {
  if (points.length === 0) return null;

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const point of points) {
    if (point.x < x0) x0 = point.x;
    if (point.y < y0) y0 = point.y;
    if (point.x > x1) x1 = point.x;
    if (point.y > y1) y1 = point.y;
  }
  return [x0, y0, x1, y1];
}

export function inflateBBox(bbox: BBox, amount: number): BBox {
  return [
    bbox[0] - amount,
    bbox[1] - amount,
    bbox[2] + amount,
    bbox[3] + amount,
  ];
}

/**
 * How far a stored box must extend past the sampled geometry for this item
 * (design §3.1 invariant 2): half the nib, plus {@link BBOX_MARGIN}.
 *
 * The nib is normalized to the **short edge** while the box is normalized per
 * axis, so an exact conversion would need the rectangle's aspect ratio — which is
 * deliberately not part of stored data. Padding isotropically over-inflates the
 * long axis, and that is safe: the box is only a prefilter, the precise test is
 * {@link hitTestItem}.
 */
export function strokeMargin(item: Annotation): number {
  switch (item.kind) {
    case "stroke":
    case "highlight":
    case "arrow":
    case "shape":
      return item.size / 2 + BBOX_MARGIN;
    case "text":
      return item.fontSize / 2 + BBOX_MARGIN;
  }
}

/**
 * The box around the item's own geometry, before inflation.
 *
 * Text is the exception: its extent depends on the glyphs, which only the DOM
 * text layer can measure (design §3.4), so a text item carries the box it was
 * born with and this returns it unchanged.
 */
export function tightBBox(item: Annotation): BBox {
  switch (item.kind) {
    case "stroke":
    case "highlight":
      return pointsBBox(item.points) ?? item.bbox;
    case "arrow":
    case "shape":
      return [
        Math.min(item.from[0], item.to[0]),
        Math.min(item.from[1], item.to[1]),
        Math.max(item.from[0], item.to[0]),
        Math.max(item.from[1], item.to[1]),
      ];
    case "text":
      return item.bbox;
  }
}

/** The box to store / prefilter with — {@link tightBBox} inflated. */
export function itemBBox(item: Annotation): BBox {
  return inflateBBox(tightBBox(item), strokeMargin(item));
}

/**
 * Recompute and attach an item's `bbox`. The canvas calls this on the item it is
 * about to commit, so the stored box is always derived rather than hand-written.
 */
export function withBBox<A extends Annotation>(item: A): A {
  if (item.kind === "text") return item;
  return { ...item, bbox: itemBBox(item) };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

export function bboxContainsPoint(
  bbox: BBox,
  x: number,
  y: number,
  pad = 0,
): boolean {
  return (
    x >= bbox[0] - pad &&
    x <= bbox[2] + pad &&
    y >= bbox[1] - pad &&
    y <= bbox[3] + pad
  );
}

/**
 * Distance-threshold thinning, applied **only** before persistence (design §3.2):
 * live rendering always uses every sampled point, because that is what makes the
 * ink keep up with the pen. The first and last points are always kept — dropping
 * the last one changes where the nib lifts off.
 */
export function simplifyPoints(
  points: readonly AnnotationPoint[],
  epsilon: number = SIMPLIFY_EPSILON,
): AnnotationPoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));

  const kept: AnnotationPoint[] = [{ ...points[0]! }];
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i]!;
    const last = kept[kept.length - 1]!;
    if (distance(point.x, point.y, last.x, last.y) >= epsilon) {
      kept.push({ ...point });
    }
  }

  const last = points[points.length - 1]!;
  const keptLast = kept[kept.length - 1]!;
  if (
    kept.length === 1 ||
    distance(last.x, last.y, keptLast.x, keptLast.y) > 0
  ) {
    kept.push({ ...last });
  }
  return kept;
}

/** Ray casting — the lasso test M7 needs; kept here because it is pure geometry. */
export function pointInPolygon(
  x: number,
  y: number,
  polygon: readonly AnnotationPoint[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.y > y !== b.y > y;
    if (straddles && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function hitTestPoints(
  points: readonly AnnotationPoint[],
  point: AnnotationPoint,
  reach: number,
): boolean {
  if (points.length === 1) {
    const only = points[0]!;
    return distance(only.x, only.y, point.x, point.y) <= reach;
  }
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (distanceToSegment(point.x, point.y, a.x, a.y, b.x, b.y) <= reach) {
      return true;
    }
  }
  return false;
}

function hitTestShape(
  item: Extract<Annotation, { kind: "shape" }>,
  point: AnnotationPoint,
  reach: number,
) {
  const [x0, y0] = item.from;
  const [x1, y1] = item.to;
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);

  if (item.shape === "rect") {
    const inside =
      point.x >= left &&
      point.x <= right &&
      point.y >= top &&
      point.y <= bottom;
    if (inside) {
      if (item.filled) return true;
      // On the outline only: inside the outer box but within `reach` of an edge.
      return (
        point.x - left <= reach ||
        right - point.x <= reach ||
        point.y - top <= reach ||
        bottom - point.y <= reach
      );
    }
    return (
      distanceToSegment(point.x, point.y, left, top, right, top) <= reach ||
      distanceToSegment(point.x, point.y, right, top, right, bottom) <= reach ||
      distanceToSegment(point.x, point.y, right, bottom, left, bottom) <=
        reach ||
      distanceToSegment(point.x, point.y, left, bottom, left, top) <= reach
    );
  }

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = Math.max((right - left) / 2, 1e-6);
  const ry = Math.max((bottom - top) / 2, 1e-6);
  const rho = Math.hypot((point.x - cx) / rx, (point.y - cy) / ry);
  if (rho <= 1) return item.filled || (1 - rho) * Math.min(rx, ry) <= reach;
  // Outside: the distance to the ellipse is approximated by the radial gap scaled
  // by the short radius. Good enough for a prefiltered, generous hit test.
  return (rho - 1) * Math.min(rx, ry) <= reach;
}

/**
 * Is `point` on `item`, within `radius` (both normalized)?
 *
 * Used by the eraser (radius = nib × 2, design §3.3) and by the future lasso /
 * point selection. The bbox prefilter is what keeps an eraser drag cheap: only
 * items whose inflated box contains the point reach the precise test.
 */
export function hitTestItem(
  item: Annotation,
  point: AnnotationPoint,
  radius: number,
): boolean {
  if (!bboxContainsPoint(itemBBox(item), point.x, point.y, radius))
    return false;

  switch (item.kind) {
    case "stroke":
    case "highlight":
      return hitTestPoints(item.points, point, radius + item.size / 2);
    case "arrow":
      return (
        distanceToSegment(
          point.x,
          point.y,
          item.from[0],
          item.from[1],
          item.to[0],
          item.to[1],
        ) <=
        radius + item.size / 2
      );
    case "shape":
      return hitTestShape(item, point, radius + item.size / 2);
    case "text":
      // The bbox prefilter already answered it: a text item's box *is* its hit
      // area (glyph-level accuracy would need the DOM measurement we don't keep).
      return true;
  }
}

/** Every item the point touches, topmost last — the eraser removes all of them. */
export function pickItems(
  items: readonly Annotation[],
  point: AnnotationPoint,
  radius: number,
): Annotation[] {
  return items.filter((item) => hitTestItem(item, point, radius));
}
