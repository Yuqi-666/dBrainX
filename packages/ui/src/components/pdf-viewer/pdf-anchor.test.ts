// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pdfAnchorDelta,
  pdfAnchorPoint,
  pdfReanchorPending,
} from "./pdf-anchor.ts";

test("zoom keeps a point on a later page under the cursor on both axes", () => {
  const before = { left: 120, top: -100, width: 600, height: 800 };
  const point = pdfAnchorPoint(before, 420, 300);
  const anchor = { page: 50, ...point, offsetX: 400, offsetY: 270, scale: 2 };
  // The new page top includes unscaled gutters and padding; use actual layout,
  // not a global scroll offset multiplied by the scale ratio.
  const after = { left: 40, top: 2340, width: 1200, height: 1600 };
  const origin = { x: 20, y: 30 };
  const delta = pdfAnchorDelta(anchor, after, origin);
  assert.equal(after.left - delta.x + point.x * after.width, 420);
  assert.equal(after.top - delta.y + point.y * after.height, 300);
});

test("a new centroid can re-anchor before a pending zoom commits", () => {
  const anchor = {
    page: 3,
    x: 0.5,
    y: 0.5,
    offsetX: 200,
    offsetY: 300,
    scale: 2,
  };
  const next = pdfReanchorPending(
    anchor,
    { left: 0, top: 0, width: 400, height: 600 },
    1,
    240,
    360,
  );
  assert.equal(next.x, 0.55);
  assert.equal(next.y, 0.55);
  assert.equal(next.page, 3);
});

test("an anchor outside a page remains usable for gutter gestures", () => {
  assert.deepEqual(
    pdfAnchorPoint({ left: 100, top: 100, width: 200, height: 200 }, 50, 350),
    { x: -0.25, y: 1.25 },
  );
});
