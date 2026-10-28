// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DENSITY_SLIDER_STEPS,
  NODE_DENSITY,
  densityScaleLabel,
  densityToPosition,
  positionToDensity,
} from "./node-density.ts";

/**
 * The default is duplicated from `DEFAULT_FORCE_CONFIG.boundaryDensity`
 * (`@workspace/graph`) because importing it would close a package cycle.
 * Pinning it here turns a change on the graph side into a visible failure
 * instead of a silent mismatch between the slider and the renderer.
 */
test("the default density matches the force renderer's default", () => {
  assert.equal(NODE_DENSITY.default, 1e-5);
});

test("the default sits inside the slider's range", () => {
  assert.ok(NODE_DENSITY.default > NODE_DENSITY.min);
  assert.ok(NODE_DENSITY.default < NODE_DENSITY.max);
});

test("the range endpoints map to the endpoints of the slider", () => {
  assert.equal(densityToPosition(NODE_DENSITY.min), 0);
  assert.equal(densityToPosition(NODE_DENSITY.max), DENSITY_SLIDER_STEPS);
  assert.equal(positionToDensity(0), NODE_DENSITY.min);
});

test("the mapping round-trips through the slider", () => {
  for (const density of [2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4]) {
    const roundTripped = positionToDensity(densityToPosition(density));
    // One slider step is a 1.5% change in density on this scale.
    assert.ok(
      Math.abs(roundTripped - density) / density < 0.02,
      `${density} round-tripped to ${roundTripped}`,
    );
  }
});

test("a larger density is a larger position (tighter boundary)", () => {
  const positions = [2e-6, 1e-5, 5e-5, 2e-4].map(densityToPosition);
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i]! > positions[i - 1]!);
  }
});

test("a value outside the range is clamped, not extrapolated", () => {
  assert.equal(densityToPosition(1e-12), 0);
  assert.equal(densityToPosition(1), DENSITY_SLIDER_STEPS);
});

test("the scale label reads 宽松 / 标准 / 紧凑", () => {
  assert.equal(densityScaleLabel(NODE_DENSITY.min), "宽松");
  assert.equal(densityScaleLabel(NODE_DENSITY.default), "标准");
  assert.equal(densityScaleLabel(NODE_DENSITY.max), "紧凑");
});
