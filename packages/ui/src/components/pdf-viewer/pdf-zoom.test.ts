// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";

import {
  PDF_MAX_SCALE,
  PDF_ZOOM_CRISP_RATIO,
  PDF_ZOOM_STRETCH_LIMIT,
  pdfZoomIsCrisp,
  pdfZoomRaster,
} from "./types.ts";

test("pdfZoomIsCrisp: the multiplier it was painted at is crisp", () => {
  assert.equal(pdfZoomIsCrisp(1, 1), true);
  assert.equal(pdfZoomIsCrisp(2.5, 2.5), true);
});

test("pdfZoomIsCrisp: a hair off is still crisp either way", () => {
  const hair = 1 + (PDF_ZOOM_CRISP_RATIO - 1) / 2;
  assert.equal(pdfZoomIsCrisp(hair, 1), true);
  assert.equal(pdfZoomIsCrisp(1, hair), true);
});

test("pdfZoomIsCrisp: growth and shrinkage are symmetric", () => {
  for (const scale of [0.3, 1, 2, 4.7]) {
    for (const painted of [0.25, 1, 3, 6]) {
      assert.equal(
        pdfZoomIsCrisp(scale, painted),
        pdfZoomIsCrisp(painted, scale),
        `${scale} vs ${painted}`,
      );
    }
  }
});

test("pdfZoomIsCrisp: a visible stretch is not crisp", () => {
  assert.equal(pdfZoomIsCrisp(PDF_ZOOM_CRISP_RATIO, 1), false);
  assert.equal(pdfZoomIsCrisp(1, PDF_ZOOM_CRISP_RATIO), false);
  assert.equal(pdfZoomIsCrisp(3, 1), false);
});

test("pdfZoomRaster: a crisp bitmap is never repainted", () => {
  assert.equal(pdfZoomRaster(1, 1, false), "skip");
  assert.equal(pdfZoomRaster(1, 1, true), "skip");
  // Even a gesture in flight leaves a crisp page alone.
  const hair = 1 + (PDF_ZOOM_CRISP_RATIO - 1) / 2;
  assert.equal(pdfZoomRaster(hair, 1, true), "skip");
});

test("pdfZoomRaster: a deliberate step repaints at once", () => {
  assert.equal(pdfZoomRaster(1.25, 1, false), "now");
  assert.equal(pdfZoomRaster(1, 2, false), "now");
});

test("pdfZoomRaster: a gesture in flight paints by stretching", () => {
  assert.equal(pdfZoomRaster(1.1, 1, true), "later");
  assert.equal(pdfZoomRaster(0.9, 1, true), "later");
  // The bound is inclusive: exactly at the limit still stretches.
  assert.equal(pdfZoomRaster(PDF_ZOOM_STRETCH_LIMIT, 1, true), "later");
  assert.equal(pdfZoomRaster(1 / PDF_ZOOM_STRETCH_LIMIT, 1, true), "later");
});

test("pdfZoomRaster: past the stretch bound the gesture repaints anyway", () => {
  assert.equal(pdfZoomRaster(PDF_ZOOM_STRETCH_LIMIT * 1.001, 1, true), "now");
  assert.equal(
    pdfZoomRaster(1 / (PDF_ZOOM_STRETCH_LIMIT * 1.001), 1, true),
    "now",
  );
});

test("pdfZoomRaster: nothing painted yet always paints, at that multiplier", () => {
  // This is the baseline the rest of the policy is measured against. A viewer
  // that treated "no bitmap recorded" as "nothing to compare" would compare the
  // multiplier against itself, answer "skip" for ever and never record one — the
  // deferral could then never run at all.
  assert.equal(pdfZoomRaster(1, null, true), "now");
  assert.equal(pdfZoomRaster(0.8, null, false), "now");
});

test("a first gesture records its baseline, then defers", () => {
  // The viewer's own sequence: the first commit has no painted bitmap, so it
  // paints now and records where; every notch after it stretches.
  let painted: number | null = null;
  let scale = 1;
  const decisions: string[] = [];

  for (let i = 0; i < 3; i++) {
    scale *= 1.28;
    const decision = pdfZoomRaster(scale, painted, true);
    decisions.push(decision);
    if (decision === "now") painted = scale;
  }

  assert.deepEqual(decisions, ["now", "later", "later"]);
  // And the settle repaint is what leaves it crisp.
  assert.equal(pdfZoomRaster(scale, scale, true), "skip");
});

test("a wheel spin to the maximum repaints a handful of times, not per notch", () => {
  // One mouse notch at WHEEL_ZOOM_SENSITIVITY = 0.0025 over 100px of delta.
  const notch = Math.exp(100 * 0.0025);
  let scale = 1;
  let painted = 1;
  let repaints = 0;

  for (let i = 0; i < 40 && scale < PDF_MAX_SCALE; i++) {
    scale = Math.min(PDF_MAX_SCALE, scale * notch);
    if (pdfZoomRaster(scale, painted, true) === "now") {
      painted = scale;
      repaints += 1;
    }
  }

  assert.equal(scale, PDF_MAX_SCALE, "the spin reaches the maximum");
  // The whole 1 → 6 sweep is log(6) / log(2) ≈ 2.6 stretches wide, so a spin that
  // repainted per notch (nine of them) fails here. The budget moves with
  // PDF_ZOOM_STRETCH_LIMIT; retune this number if that knob is retuned.
  assert.ok(repaints > 0, "a long gesture still sharpens");
  assert.ok(repaints <= 3, `expected a few repaints, got ${repaints}`);
  // And what it leaves on screen is never worse than the stretch bound.
  assert.ok(
    scale / painted <= PDF_ZOOM_STRETCH_LIMIT + 1e-9,
    `left stretched by ${scale / painted}`,
  );
});

test("the settle timer's repaint is what makes a stream end crisp", () => {
  // A gesture's last notch is "later" (so a stream is cheap); the deferred
  // repaint that follows commits exactly that multiplier, which is then crisp.
  const last = 1.28;
  assert.equal(pdfZoomRaster(last, 1, true), "later");
  assert.equal(pdfZoomRaster(last, last, true), "skip");
});
