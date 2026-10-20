// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pure math behind the morph, pinned. Run with:
 *
 * ```sh
 * pnpm --filter=@workspace/ui test
 * ```
 *
 * These are the island's most load-bearing numbers — the swap window, the
 * viewport caps and the pill's radius sentinel all decide how the capsule feels,
 * and none of them are reachable by a screenshot assertion. Keeping them
 * executable is the cheapest insurance the component has.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  layerOpacity,
  layerScale,
  proximity,
  resolveGeometry,
  VIEWPORT_GUTTER,
  type BoxSpec,
} from "./geometry.ts";

const FORM: BoxSpec = {
  width: 560,
  height: 440,
  maxHeightRatio: 0.52,
  radius: 28,
};

const PILL: BoxSpec = {
  width: "content",
  height: 40,
  maxHeightRatio: null,
  radius: 9999,
};

test("a form is authored at its own size on a roomy viewport", () => {
  assert.deepEqual(
    resolveGeometry(FORM, { w: 1280, h: 900 }, { w: 133, h: 40 }),
    {
      w: 560,
      h: 440,
      radius: 28,
    },
  );
});

test("the viewport gutter wins over the authored width", () => {
  const geometry = resolveGeometry(FORM, { w: 400, h: 900 }, { w: 133, h: 40 });
  assert.equal(geometry.w, 400 - VIEWPORT_GUTTER);
});

test("the height ratio wins over the authored height on a short viewport", () => {
  const geometry = resolveGeometry(
    FORM,
    { w: 1280, h: 600 },
    { w: 133, h: 40 },
  );
  assert.equal(geometry.h, 600 * 0.52);
});

test("a zero viewport still resolves to a paintable box", () => {
  const geometry = resolveGeometry(FORM, { w: 0, h: 0 }, { w: 133, h: 40 });
  assert.ok(geometry.w >= 1 && geometry.h >= 1);
});

test("`content` width is the measured pill, and the radius sentinel becomes a pill", () => {
  const geometry = resolveGeometry(
    PILL,
    { w: 1280, h: 900 },
    { w: 133, h: 40 },
  );
  assert.equal(geometry.w, 133);
  assert.equal(geometry.h, 40);
  assert.equal(geometry.radius, 20);
});

test("a `content` form takes its height from the row, over the authored floor", () => {
  // A coarse pointer grows every nav item to a 44px touch target. The pill has
  // to be 44 tall with it — a 40px capsule clips the row it is measured from.
  assert.deepEqual(
    resolveGeometry(PILL, { w: 1280, h: 900 }, { w: 155, h: 44 }),
    { w: 155, h: 44, radius: 22 },
  );

  // Below the floor the authored height wins: a fine pointer's 36px items still
  // get the 40px pill they were designed around.
  assert.equal(
    resolveGeometry(PILL, { w: 1280, h: 900 }, { w: 131, h: 36 }).h,
    40,
  );
});

test("the authored height still rules every non-`content` form", () => {
  // A 44px pill in the measurement must not leak into an expanded panel.
  assert.equal(
    resolveGeometry(FORM, { w: 1280, h: 900 }, { w: 155, h: 44 }).h,
    440,
  );
});

test("proximity reads as a distance in both directions", () => {
  const box = { w: 560, h: 440 };
  assert.equal(proximity(box, box), 1);

  // Expanding: the pill measured against a 560×440 target is 11× away, because
  // the *height* is the binding axis (40 / 440).
  assert.equal(proximity({ w: 133, h: 40 }, box), 11);

  // Collapsing: the same pair measured the other way is 4.21× away, because the
  // binding axis flips to the width (560 / 133). The value is therefore
  // direction-dependent — which is why the fade windows are directional too.
  assert.ok(Math.abs(proximity(box, { w: 133, h: 40 }) - 560 / 133) < 1e-12);
});

test("an incoming layer is opaque only when the box has arrived", () => {
  const fade = { from: 3.2, to: 1.15 };
  assert.equal(layerOpacity(1, "in", fade), 1);
  assert.equal(layerOpacity(1.15, "in", fade), 1);
  assert.equal(layerOpacity(3.2, "in", fade), 0);
  assert.equal(layerOpacity(11, "in", fade), 0);
  // Halfway up the window.
  assert.ok(Math.abs(layerOpacity((3.2 + 1.15) / 2, "in", fade) - 0.5) < 1e-9);
});

test("an outgoing layer holds until the window's near edge", () => {
  const fade = { from: 1.5, to: 1.08 };
  assert.equal(layerOpacity(4.2, "out", fade), 1);
  assert.equal(layerOpacity(1.5, "out", fade), 1);
  assert.equal(layerOpacity(1.08, "out", fade), 0);
  assert.equal(layerOpacity(1, "out", fade), 0);
});

test("a hand-over that is over is a constant, not a curve", () => {
  // `done`: the incoming body owns the capsule from the first frame, however far
  // away the box still is, and the outgoing one is already gone.
  assert.equal(layerOpacity(11, "in", "done"), 1);
  assert.equal(layerOpacity(1, "in", "done"), 1);
  assert.equal(layerOpacity(11, "out", "done"), 0);
  assert.equal(layerOpacity(1, "out", "done"), 0);
});

test("a hand-over at a point switches as the box crosses it", () => {
  const at = { at: 1.06 };

  // Held for the whole descent …
  assert.equal(layerOpacity(4.2, "out", at), 1);
  assert.equal(layerOpacity(1.07, "out", at), 1);
  assert.equal(layerOpacity(4.2, "in", at), 0);

  // … and swapped the moment the box is inside the threshold.
  assert.equal(layerOpacity(1.05, "out", at), 0);
  assert.equal(layerOpacity(1.05, "in", at), 1);
  assert.equal(layerOpacity(1, "in", at), 1);
});

test("a layer never grows past its authored size", () => {
  assert.equal(layerScale(FORM, { w: 560, h: 440 }, { w: 1120, h: 880 }), 1);
  assert.equal(layerScale(PILL, { w: 133, h: 40 }, { w: 560, h: 440 }), 1);
});

test("scaling is uniform, so a morph cannot distort a layer", () => {
  const scale = layerScale(FORM, { w: 560, h: 440 }, { w: 280, h: 330 });
  assert.equal(scale, 0.5);
});

test("a content-width layer only ever scales down vertically", () => {
  assert.equal(layerScale(PILL, { w: 133, h: 40 }, { w: 560, h: 20 }), 0.5);
});
