// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pan/zoom arithmetic, pinned. Run with:
 *
 * ```sh
 * pnpm --filter=@workspace/ui test
 * ```
 *
 * These four functions are what "annotation and image stay overlapped" actually
 * means in code: the host paints the base with `transformToCss(t)` and computes
 * the ink rectangle with `applyTransform(rect, t, origin)`, so the only way the
 * two can disagree is if this file is wrong. `clampTransform` in particular is
 * arithmetic no browser will complain about — a bad clamp silently lets the
 * photo be dragged off screen — so every branch below is asserted.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyTransform,
  clampScale,
  clampTransform,
  IDENTITY_TRANSFORM,
  isIdentityTransform,
  MAX_VIEWPORT_SCALE,
  MIN_VIEWPORT_SCALE,
  panTransform,
  pinchTransform,
  scaleAbout,
  transformToCss,
  zoomAbout,
} from "./transform.ts";
import type {
  ViewportBounds,
  ViewportPoint,
  ViewportTransform,
} from "./types.ts";

/** `M(q)` from the module header — the point a viewport point lands on. */
function mapPoint(
  point: ViewportPoint,
  transform: ViewportTransform,
  origin: ViewportPoint,
): ViewportPoint {
  const mapped = applyTransform(
    { left: point.x, top: point.y, width: 0, height: 0 },
    transform,
    origin,
  );
  return { x: mapped.left, y: mapped.top };
}

function close(actual: number, expected: number, epsilon = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

/**
 * A 4:3 photo fitted into a 1000×800 container: the painted rectangle is
 * 1000×750 with a 25px letterbox top and bottom, and the element's layout box is
 * the whole 1000×800, so its top-left is the scale origin.
 */
const BOUNDS: ViewportBounds = {
  content: { left: 0, top: 25, width: 1000, height: 750 },
  viewport: { left: 0, top: 0, width: 1000, height: 800 },
  origin: { x: 0, y: 0 },
};

test("identity transform paints the rectangle it was given", () => {
  const painted = applyTransform(BOUNDS.content, IDENTITY_TRANSFORM, {
    x: 0,
    y: 0,
  });
  assert.deepEqual(painted, BOUNDS.content);
});

test("translate + scale maps a rectangle about the element's own top-left", () => {
  const painted = applyTransform(
    { left: 100, top: 50, width: 200, height: 100 },
    { scale: 2, x: 10, y: -20 },
    { x: 40, y: 30 },
  );
  close(painted.left, 2 * 100 + (1 - 2) * 40 + 10);
  close(painted.top, 2 * 50 + (1 - 2) * 30 - 20);
  close(painted.width, 400);
  close(painted.height, 200);
});

test("zoomAbout leaves the pivot exactly where it was", () => {
  const origin = { x: 40, y: 30 };
  const pivot = { x: 310, y: 220 };
  const base: ViewportTransform = { scale: 1.7, x: -25, y: 60 };
  const zoomed = zoomAbout(base, 1.6, pivot, origin);

  const contentPoint = {
    x: origin.x + (pivot.x - origin.x - base.x) / base.scale,
    y: origin.y + (pivot.y - origin.y - base.y) / base.scale,
  };
  const after = mapPoint(contentPoint, zoomed, origin);
  close(after.x, pivot.x);
  close(after.y, pivot.y);
  close(zoomed.scale, 1.7 * 1.6);
});

test("zoomAbout rejects a degenerate pinch instead of returning Infinity", () => {
  const base = { scale: 1, x: 0, y: 0 };
  assert.deepEqual(zoomAbout(base, 0, { x: 0, y: 0 }, { x: 0, y: 0 }), base);
  assert.deepEqual(
    zoomAbout(base, Number.POSITIVE_INFINITY, { x: 0, y: 0 }, { x: 0, y: 0 }),
    base,
  );
});

test("scaleAbout is zoomAbout with the ratio derived from a target scale", () => {
  const origin = { x: 0, y: 0 };
  const pivot = { x: 500, y: 400 };
  const base: ViewportTransform = { scale: 2, x: -500, y: -400 };
  assert.deepEqual(
    scaleAbout(base, 3, pivot, origin),
    zoomAbout(base, 1.5, pivot, origin),
  );
});

test("pinchTransform keeps the anchored content point under the fingers' midpoint", () => {
  const origin = { x: 0, y: 0 };
  const base: ViewportTransform = { scale: 1, x: 0, y: 0 };
  const from = { x: 200, y: 150 };
  const to = { x: 260, y: 190 };

  const next = pinchTransform(base, 2, from, to, origin);
  // The content point that was under `from` must now be under `to`.
  const followed = mapPoint(from, next, origin);
  close(followed.x, to.x);
  close(followed.y, to.y);
  close(next.scale, 2);
});

test("a pinch from a zoomed and panned view preserves the screen anchor", () => {
  const origin = { x: 40, y: 30 };
  const base = { scale: 2, x: -100, y: -70 };
  const from = { x: 240, y: 200 };
  const to = { x: 260, y: 230 };
  const point = {
    x: origin.x + (from.x - origin.x - base.x) / base.scale,
    y: origin.y + (from.y - origin.y - base.y) / base.scale,
  };
  const mapped = mapPoint(
    point,
    pinchTransform(base, 1.5, from, to, origin),
    origin,
  );
  close(mapped.x, to.x);
  close(mapped.y, to.y);
});

test("panTransform adds viewport pixels and ignores a no-op", () => {
  const base: ViewportTransform = { scale: 3, x: 10, y: 20 };
  assert.deepEqual(panTransform(base, 5, -7), { scale: 3, x: 15, y: 13 });
  assert.equal(panTransform(base, 0, 0), base);
});

test("clampScale pins to the fit floor and the maximum", () => {
  assert.equal(clampScale(0.2), MIN_VIEWPORT_SCALE);
  assert.equal(clampScale(999), MAX_VIEWPORT_SCALE);
  assert.equal(clampScale(2.5), 2.5);
  assert.equal(clampScale(Number.NaN), MIN_VIEWPORT_SCALE);
});

test("isIdentityTransform tolerates sub-pixel drift but not a real move", () => {
  assert.equal(isIdentityTransform(IDENTITY_TRANSFORM), true);
  assert.equal(isIdentityTransform({ scale: 1.0002, x: 0.2, y: -0.2 }), true);
  assert.equal(isIdentityTransform({ scale: 1.01, x: 0, y: 0 }), false);
  assert.equal(isIdentityTransform({ scale: 1, x: 4, y: 0 }), false);
});

test("transformToCss is the exact pairing of transform-origin: 0 0", () => {
  assert.equal(
    transformToCss({ scale: 2, x: -3.5, y: 12 }),
    "translate3d(-3.5px, 12px, 0) scale(2)",
  );
});

test("the clamp's fixed point is fit: reset survives clamping", () => {
  const clamped = clampTransform(IDENTITY_TRANSFORM, BOUNDS);
  close(clamped.x, 0);
  close(clamped.y, 0);
  close(clamped.scale, 1);
});

test("an identity transform is never corrected, even by an asymmetric clamp box", () => {
  // A host whose padding is not symmetric would otherwise see the photo shift the
  // first time a finger touched it; `reset()` must land back exactly on the layout.
  const lopsided: ViewportBounds = {
    content: { left: 40, top: 25, width: 900, height: 750 },
    viewport: { left: 0, top: 0, width: 1000, height: 800 },
    origin: { x: 30, y: 10 },
  };
  assert.deepEqual(
    clampTransform(IDENTITY_TRANSFORM, lopsided),
    IDENTITY_TRANSFORM,
  );
  // …while a real transform in the same box is still clamped.
  const panned = clampTransform({ scale: 1, x: 4000, y: 0 }, lopsided);
  assert.notEqual(panned.x, 4000);
});

test("the clamp centres an axis that is smaller than the viewport", () => {
  // 400 wide inside 1000, sitting off-centre at rest: the only stable position
  // is the centred one, so the clamp has to move it there on its own.
  const wide: ViewportBounds = {
    content: { left: 100, top: 0, width: 400, height: 800 },
    viewport: { left: 0, top: 0, width: 1000, height: 800 },
    origin: { x: 100, y: 0 },
  };
  const clamped = clampTransform({ scale: 1, x: 999, y: 0 }, wide);
  close(clamped.x, 200);
  close(clamped.y, 0);
  // …and the result is centred: 100 + 200 = 300, i.e. (1000 − 400) / 2.
  close(applyTransform(wide.content, clamped, wide.origin).left, 300);
});

test("the clamp lets a zoomed base be panned but never dragged off screen", () => {
  // Scale is in range, so only translation is corrected: the content is pinned
  // so its top-left corner still covers the viewport.
  const zoomed = clampTransform({ scale: 2, x: 0, y: 0 }, BOUNDS);
  close(zoomed.x, 0);
  close(zoomed.y, -50);
  const painted = applyTransform(BOUNDS.content, zoomed, BOUNDS.origin);
  close(painted.left, 0);
  close(painted.top, 0);
  assert.ok(painted.left + painted.width >= 1000);
  assert.ok(painted.top + painted.height >= 800);

  // Dragging far right/up is stopped when the leading edge reaches the viewport.
  const dragged = clampTransform({ scale: 2, x: 5000, y: 5000 }, BOUNDS);
  close(dragged.x, 0);
  close(dragged.y, -50);

  // Dragging far left/down is stopped when the trailing edge reaches it.
  const draggedBack = clampTransform({ scale: 2, x: -5000, y: -5000 }, BOUNDS);
  close(draggedBack.x, -1000);
  close(draggedBack.y, -750);
});

test("an out-of-range scale is pulled back about the viewport centre", () => {
  const clamped = clampTransform({ scale: 0.1, x: 0, y: 0 }, BOUNDS);
  close(clamped.scale, 1);
  close(clamped.x, 0);
  close(clamped.y, 0);
});
