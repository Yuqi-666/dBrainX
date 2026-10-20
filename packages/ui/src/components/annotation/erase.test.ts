// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Stroke, Highlight } from "@workspace/interfaces";
import { erasePath, eraserSamples } from "./erase.ts";
import { withBBox } from "./geometry.ts";

const ink: Stroke = withBBox({
  id: "original",
  kind: "stroke",
  z: 7,
  bbox: [0, 0, 0, 0],
  color: "red",
  opacity: 1,
  createdAt: 1,
  page: 2,
  size: 0.01,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: false,
  points: [
    { x: 0.1, y: 0.5, p: 0.2 },
    { x: 0.9, y: 0.5, p: 0.8 },
  ],
});

test("path eraser cuts the middle of sparse ink without removing either end", () => {
  const parts = erasePath([ink], [{ x: 0.5, y: 0.5 }], 0.04);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]!.kind, "stroke");
  assert.equal(parts[1]!.kind, "stroke");
  if (parts[0]!.kind !== "stroke" || parts[1]!.kind !== "stroke") return;
  assert.deepEqual(parts[0]!.points[0], ink.points[0]);
  assert.deepEqual(parts[1]!.points.at(-1), ink.points.at(-1));
  assert.ok(parts[0]!.points.at(-1)!.x < 0.46);
  assert.ok(parts[1]!.points[0]!.x > 0.54);
  assert.ok(parts[0]!.points.at(-1)!.p! > 0.2);
  for (const part of parts) {
    assert.equal(part.page, 2);
    assert.equal(part.z, 7);
    assert.equal(part.color, "red");
  }
  assert.equal(ink.points.length, 2);
});

test("fast swept erasing reaches ink between delivered pointer samples", () => {
  const samples = eraserSamples({ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.9 }, 0.02);
  assert.equal(erasePath([ink], samples, 0.02).length, 2);
});

test("untouched ink retains identity and repeated cuts do not reconnect fragments", () => {
  assert.equal(erasePath([ink], [{ x: 0.1, y: 0.1 }], 0.02)[0], ink);
  const first = erasePath([ink], [{ x: 0.5, y: 0.5 }], 0.04);
  const next = erasePath(first, [{ x: 0.3, y: 0.5 }], 0.04);
  assert.equal(next.length, 3);
});

test("dots disappear and highlighter fragments retain their blend", () => {
  const dot = withBBox({ ...ink, points: [{ x: 0.5, y: 0.5 }] });
  assert.deepEqual(erasePath([dot], [{ x: 0.5, y: 0.5 }], 0.02), []);
  const highlight: Highlight = {
    ...ink,
    kind: "highlight",
    blend: "multiply",
    opacity: 0.35,
  };
  const parts = erasePath([highlight], [{ x: 0.5, y: 0.5 }], 0.04);
  assert.equal(parts.length, 2);
  for (const part of parts) {
    assert.equal(part.kind, "highlight");
    if (part.kind === "highlight") assert.equal(part.blend, "multiply");
  }
});
