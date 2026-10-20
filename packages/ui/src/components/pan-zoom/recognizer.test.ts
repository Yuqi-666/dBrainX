// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The gesture decisions, pinned. Run with:
 *
 * ```sh
 * pnpm --filter=@workspace/ui test
 * ```
 *
 * These thresholds are the difference between "双指轻点撤回 works" and "it undoes
 * a stroke while I am drawing": a tap is only a tap if it neither moved nor
 * lasted, a two-finger tap is undo and a three-finger tap is redo, and a double
 * tap needs both time and space to agree. Each is invisible in a screenshot until
 * it fires at the wrong moment, so each is asserted here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  centroidOf,
  classifyTapEnd,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP,
  isDoubleTap,
  spreadOf,
  TAP_MAX_MS,
  TAP_SLOP,
  type TapState,
} from "./recognizer.ts";

const TAP: TapState = {
  tap: true,
  touch: true,
  moved: false,
  duration: 120,
  peak: 1,
};

test("centroidOf averages the live points", () => {
  assert.deepEqual(
    centroidOf([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 40 },
    ]),
    { x: 10, y: 20 },
  );
  assert.deepEqual(centroidOf([]), { x: 0, y: 0 });
});

test("spreadOf is half the finger distance for two fingers", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  assert.equal(spreadOf(points, centroidOf(points)), 50);
});

test("spreadOf ignores a single finger and survives losing one of three", () => {
  assert.equal(spreadOf([{ x: 5, y: 5 }], { x: 5, y: 5 }), 0);
  // Two of the original three: the spread shrinks but nothing divides by zero or
  // changes which pair is measured.
  const three = [
    { x: -60, y: 0 },
    { x: 0, y: 0 },
    { x: 60, y: 0 },
  ];
  const two = three.slice(0, 2);
  assert.ok(spreadOf(two, centroidOf(two)) > 0);
  assert.ok(spreadOf(three, centroidOf(three)) > 0);
});

test("classifyTapEnd reads the finger count", () => {
  assert.equal(classifyTapEnd(TAP), "tap");
  assert.equal(classifyTapEnd({ ...TAP, peak: 2 }), "undo");
  assert.equal(classifyTapEnd({ ...TAP, peak: 3 }), "redo");
  assert.equal(classifyTapEnd({ ...TAP, peak: 5 }), "redo");
});

test("classifyTapEnd rejects a drag, a press and a mouse", () => {
  assert.equal(classifyTapEnd({ ...TAP, moved: true }), null);
  assert.equal(classifyTapEnd({ ...TAP, duration: TAP_MAX_MS + 1 }), null);
  assert.equal(classifyTapEnd({ ...TAP, duration: TAP_MAX_MS }), "tap");
  assert.equal(classifyTapEnd({ ...TAP, touch: false }), null);
  assert.equal(classifyTapEnd({ ...TAP, tap: false }), null);
});

test("a wobble inside the slop is still a tap", () => {
  // `moved` is computed by the caller against TAP_SLOP; this pins the boundary
  // the hook uses so the two cannot drift apart.
  assert.equal(TAP_SLOP, 10);
});

test("isDoubleTap needs both time and space to agree", () => {
  const first = { time: 1000, x: 300, y: 300 };
  assert.equal(isDoubleTap(first, { time: 1200, x: 305, y: 298 }), true);
  assert.equal(isDoubleTap(first, { time: 1200, x: 900, y: 300 }), false);
  assert.equal(
    isDoubleTap(first, { time: 1000 + DOUBLE_TAP_MS + 1, x: 300, y: 300 }),
    false,
  );
  assert.equal(
    isDoubleTap(first, { time: 1000, x: 300, y: 300 + DOUBLE_TAP_SLOP + 1 }),
    false,
  );
  assert.equal(isDoubleTap(null, { time: 1000, x: 0, y: 0 }), false);
});

test("isDoubleTap refuses a clock that went backwards", () => {
  assert.equal(
    isDoubleTap({ time: 5000, x: 0, y: 0 }, { time: 10, x: 0, y: 0 }),
    false,
  );
});
