// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The coordinate chain, pinned. Run with:
 *
 * ```sh
 * pnpm --filter=@workspace/ui test
 * ```
 *
 * These functions decide whether a mark stays on the same pixel of the same photo
 * after a window resize, a device change or a theme swap, and every one of them is
 * invisible in a screenshot until it is wrong. `containRect` in particular is
 * arithmetic no browser will check for us: the letterbox is produced by CSS, so
 * the only place it can be verified is here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Annotation } from "@workspace/interfaces";

import {
  bboxContainsPoint,
  bboxIntersects,
  clamp01,
  containRect,
  distanceToSegment,
  hitTestItem,
  inflateBBox,
  itemBBox,
  normalizePoint,
  pickItems,
  pointInPolygon,
  pointsBBox,
  simplifyPoints,
  strokeMargin,
  toDisplayPoint,
  toDisplaySize,
  toLayerBox,
  toNormalizedSize,
  withBBox,
} from "./geometry.ts";
import type { BaseRect } from "./types.ts";

const BOX: BaseRect = { left: 100, top: 50, width: 400, height: 400 };

test("containRect letterboxes a wide image top and bottom", () => {
  // 2:1 image in a square box → the width is the binding constraint, so the image
  // is 400×200 and centred vertically.
  const rect = containRect(BOX, 2000, 1000);
  assert.deepEqual(rect, { left: 100, top: 150, width: 400, height: 200 });
});

test("containRect letterboxes a tall image left and right", () => {
  const rect = containRect(BOX, 1000, 2000);
  assert.deepEqual(rect, { left: 200, top: 50, width: 200, height: 400 });
});

test("containRect is the identity for a matching aspect ratio", () => {
  assert.deepEqual(containRect(BOX, 300, 300), BOX);
});

test("containRect refuses to divide by an unloaded image", () => {
  assert.deepEqual(containRect(BOX, 0, 0), BOX);
  assert.deepEqual(
    containRect({ left: 0, top: 0, width: 0, height: 0 }, 100, 100),
    { left: 0, top: 0, width: 0, height: 0 },
  );
});

test("toLayerBox undoes the scale an opening Dialog paints under", () => {
  // The G5 defect, in numbers: the layer root is 800×400 in layout pixels and the
  // Dialog is `zoom-in-95`, so every `getBoundingClientRect()` in that subtree
  // comes back 5% small. A box measured now must still come out in *layout* pixels
  // (16, 16, 768, 368) — the numbers a ResizeObserver can never correct, because a
  // transform is not a layout change.
  const layout = { width: 800, height: 400 };
  const scale = 0.95;
  const origin = {
    left: 195,
    top: 195,
    width: 800 * scale,
    height: 400 * scale,
  };
  const rect = {
    left: 195 + 16 * scale,
    top: 195 + 16 * scale,
    width: 768 * scale,
    height: 368 * scale,
  };
  const box = toLayerBox(rect, origin, layout);
  approx([box.left, box.top, box.width, box.height], [16, 16, 768, 368]);
});

test("toLayerBox corrects the axes separately", () => {
  // A `scale(sx, sy)` animation is not uniform; correcting with one number would
  // leave the other axis wrong.
  const box = toLayerBox(
    { left: 110, top: 130, width: 200, height: 100 },
    { left: 100, top: 100, width: 400, height: 400 },
    { width: 800, height: 400 }, // sx = 0.5, sy = 1
  );
  approx([box.left, box.top, box.width, box.height], [20, 30, 400, 100]);
});

test("toLayerBox is the identity without a transform", () => {
  const origin = { left: 40, top: 10, width: 800, height: 400 };
  const rect = { left: 56, top: 26, width: 768, height: 368 };
  const box = toLayerBox(rect, origin, { width: 800, height: 400 });
  approx([box.left, box.top, box.width, box.height], [16, 16, 768, 368]);
});

test("toLayerBox falls back to 1:1 when the layout size is unusable", () => {
  const origin = { left: 0, top: 0, width: 800, height: 400 };
  const rect = { left: 16, top: 16, width: 768, height: 368 };
  for (const layout of [
    { width: 0, height: 0 },
    { width: Number.NaN, height: 400 },
  ]) {
    const box = toLayerBox(rect, origin, layout);
    approx([box.left, box.top, box.width, box.height], [16, 16, 768, 368]);
  }
});

test("normalizePoint and toDisplayPoint are inverse", () => {
  const point = normalizePoint(BOX, 300, 250); // exactly the box centre
  assert.deepEqual(point, { x: 0.5, y: 0.5 });
  assert.deepEqual(toDisplayPoint(BOX, point), { x: 300, y: 250 });
});

test("normalizePoint clamps instead of dropping an edge sample", () => {
  assert.deepEqual(normalizePoint(BOX, -50, 10_000), { x: 0, y: 1 });
  assert.equal(clamp01(Number.NaN), 0);
});

test("normalizePoint survives a collapsed rectangle", () => {
  assert.deepEqual(
    normalizePoint({ left: 0, top: 0, width: 0, height: 0 }, 5, 5),
    { x: 0, y: 0 },
  );
});

test("a stored size is a fraction of the short edge", () => {
  const wide: BaseRect = { left: 0, top: 0, width: 1000, height: 500 };
  assert.equal(toDisplaySize(0.01, wide), 5);
  assert.equal(toNormalizedSize(5, wide), 0.01);
  assert.equal(
    toNormalizedSize(5, { left: 0, top: 0, width: 0, height: 0 }),
    0,
  );
});

test("distanceToSegment projects onto the segment, not the line", () => {
  assert.equal(distanceToSegment(5, 3, 0, 0, 10, 0), 3);
  // Beyond the end: the nearest point is the endpoint, not the infinite line.
  assert.equal(distanceToSegment(20, 0, 0, 0, 10, 0), 10);
  // A degenerate segment is a point.
  assert.equal(distanceToSegment(3, 4, 0, 0, 0, 0), 5);
});

test("simplifyPoints keeps the ends and drops sub-epsilon jitter", () => {
  const points = [
    { x: 0, y: 0, p: 0.2 },
    { x: 0.0001, y: 0, p: 0.3 },
    { x: 0.01, y: 0, p: 0.4 },
    { x: 0.0101, y: 0, p: 0.5 },
    { x: 0.02, y: 0 },
  ];
  const kept = simplifyPoints(points, 0.002);
  assert.deepEqual(
    kept.map((point) => point.x),
    [0, 0.01, 0.02],
  );
  // Pressure rides along with the point that was kept.
  assert.equal(kept[1]!.p, 0.4);
});

test("simplifyPoints leaves a stroke of two points alone", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0.0001, y: 0 },
  ];
  assert.deepEqual(simplifyPoints(points, 1), points);
});

/** Normalized geometry is float arithmetic; compare it with a tolerance. */
function approx(actual: readonly number[], expected: readonly number[]): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => {
    assert.ok(
      Math.abs(value - expected[i]!) < 1e-9,
      `[${actual.join(", ")}] ≉ [${expected.join(", ")}] at ${i}`,
    );
  });
}

test("bbox helpers inflate, test, and intersect", () => {
  approx(
    pointsBBox([
      { x: 0.2, y: 0.4 },
      { x: 0.6, y: 0.1 },
    ])!,
    [0.2, 0.1, 0.6, 0.4],
  );
  assert.equal(pointsBBox([]), null);
  approx(inflateBBox([0.2, 0.1, 0.6, 0.4], 0.05), [0.15, 0.05, 0.65, 0.45]);
  assert.equal(bboxContainsPoint([0, 0, 1, 1], 0.5, 0.5), true);
  assert.equal(bboxContainsPoint([0, 0, 0.4, 0.4], 0.5, 0.5), false);
  assert.equal(bboxContainsPoint([0, 0, 0.4, 0.4], 0.5, 0.5, 0.2), true);
  assert.equal(bboxIntersects([0, 0, 0.5, 0.5], [0.4, 0.4, 1, 1]), true);
  assert.equal(bboxIntersects([0, 0, 0.2, 0.2], [0.4, 0.4, 1, 1]), false);
});

const STROKE: Annotation = {
  id: "s1",
  kind: "stroke",
  z: 0,
  bbox: [0, 0, 0, 0],
  color: "red",
  opacity: 1,
  createdAt: 0,
  points: [
    { x: 0.2, y: 0.5 },
    { x: 0.8, y: 0.5 },
  ],
  size: 0.02,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
};

test("a stroke's stored box is inflated past its nib", () => {
  const box = itemBBox(STROKE);
  assert.equal(strokeMargin(STROKE), 0.014);
  approx(box, [0.186, 0.486, 0.814, 0.514]);
  // …and the tight geometry stays inside it, which is the whole point.
  assert.ok(box[0]! < 0.2 && box[1]! < 0.5 && box[2]! > 0.8 && box[3]! > 0.5);
});

test("withBBox derives the box rather than trusting the input", () => {
  const derived = withBBox(STROKE);
  assert.deepEqual(derived.bbox, itemBBox(STROKE));
  assert.notEqual(derived, STROKE);
});

test("hitTestItem uses the nib as slack", () => {
  // 0.005 above the line: inside nib/2 (0.01) + radius (0), so a hit.
  assert.equal(hitTestItem(STROKE, { x: 0.5, y: 0.505 }, 0), true);
  assert.equal(hitTestItem(STROKE, { x: 0.5, y: 0.53 }, 0), false);
  // The eraser's radius is the nib × 2, so a wider reach still catches it.
  assert.equal(hitTestItem(STROKE, { x: 0.5, y: 0.53 }, 0.025), true);
  // Beyond the segment's end, only the radius reaches.
  assert.equal(hitTestItem(STROKE, { x: 0.9, y: 0.5 }, 0), false);
  assert.equal(hitTestItem(STROKE, { x: 0.9, y: 0.5 }, 0.11), true);
});

test("an empty point list is unhittable rather than a crash", () => {
  const empty: Annotation = { ...STROKE, points: [] };
  assert.equal(hitTestItem(empty, { x: 0.5, y: 0.5 }, 0.5), false);
});

test("filled shapes hit from inside, outline shapes only near the edge", () => {
  const base = {
    id: "r1",
    kind: "shape" as const,
    z: 0,
    bbox: [0, 0, 0, 0] as [number, number, number, number],
    color: "blue",
    opacity: 1,
    createdAt: 0,
    shape: "rect" as const,
    from: [0.2, 0.2] as [number, number],
    to: [0.8, 0.8] as [number, number],
    size: 0.01,
  };
  assert.equal(
    hitTestItem({ ...base, filled: false }, { x: 0.5, y: 0.5 }, 0),
    false,
  );
  assert.equal(
    hitTestItem({ ...base, filled: false }, { x: 0.2, y: 0.5 }, 0),
    true,
  );
  assert.equal(
    hitTestItem({ ...base, filled: true }, { x: 0.5, y: 0.5 }, 0),
    true,
  );
  // An ellipse is not a rectangle: the box corner is outside the curve.
  const ellipse: Annotation = { ...base, shape: "ellipse", filled: true };
  assert.equal(hitTestItem(ellipse, { x: 0.5, y: 0.5 }, 0), true);
  assert.equal(hitTestItem(ellipse, { x: 0.206, y: 0.206 }, 0), false);
});

test("an arrow hits along its shaft", () => {
  const arrow: Annotation = {
    id: "a1",
    kind: "arrow",
    z: 0,
    bbox: [0, 0, 0, 0],
    color: "ink",
    opacity: 1,
    createdAt: 0,
    from: [0.1, 0.1],
    to: [0.9, 0.9],
    size: 0.01,
  };
  assert.equal(hitTestItem(arrow, { x: 0.5, y: 0.5 }, 0), true);
  assert.equal(hitTestItem(arrow, { x: 0.5, y: 0.7 }, 0), false);
});

test("a text item's box is its hit area", () => {
  const text: Annotation = {
    id: "t1",
    kind: "text",
    z: 0,
    bbox: [0.3, 0.3, 0.7, 0.4],
    color: "ink",
    opacity: 1,
    createdAt: 0,
    x: 0.3,
    y: 0.3,
    text: "hello",
    fontSize: 0.05,
    align: "left",
  };
  assert.equal(hitTestItem(text, { x: 0.5, y: 0.35 }, 0), true);
  assert.equal(hitTestItem(text, { x: 0.9, y: 0.35 }, 0), false);
  // `withBBox` must not clobber the box the DOM measured for it.
  assert.equal(withBBox(text), text);
});

test("pickItems returns everything under the point", () => {
  const highlight: Annotation = {
    ...STROKE,
    id: "h1",
    kind: "highlight",
    blend: "multiply",
  };
  const picked = pickItems([STROKE, highlight], { x: 0.5, y: 0.5 }, 0);
  assert.deepEqual(
    picked.map((item) => item.id),
    ["s1", "h1"],
  );
  assert.deepEqual(pickItems([STROKE], { x: 0.5, y: 0.9 }, 0), []);
});

test("pointInPolygon is a real crossing test", () => {
  const square = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];
  assert.equal(pointInPolygon(0.5, 0.5, square), true);
  assert.equal(pointInPolygon(0.1, 0.5, square), false);
  assert.equal(pointInPolygon(0.5, 0.9, square), false);
});
