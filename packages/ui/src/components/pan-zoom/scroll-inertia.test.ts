// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { test } from "node:test";
import { inertiaStep } from "./scroll-inertia.ts";

test("momentum decays equally across 60Hz and 120Hz frames", () => {
  const full = inertiaStep(1, 16);
  const first = inertiaStep(1, 8);
  const second = inertiaStep(first.velocity, 8);
  assert.ok(Math.abs(full.delta - first.delta - second.delta) < 1e-10);
  assert.ok(Math.abs(full.velocity - second.velocity) < 1e-10);
});

test("momentum preserves direction and does not jump after a stalled frame", () => {
  const result = inertiaStep(-2, 1000);
  assert.ok(result.delta < 0 && result.delta > -64);
  assert.ok(result.velocity < 0 && result.velocity > -2);
  assert.deepEqual(inertiaStep(0, 16), { delta: 0, velocity: 0 });
});
