// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";

import { PDF_MAX_DPR, PDF_MAX_PIXELS, pdfRasterDpr } from "./types.ts";

/** A page of the given CSS size, painted at the density the policy answers. */
function priced(width: number, height: number, dpr: number) {
  const density = pdfRasterDpr(dpr, width, height);
  return { density, pixels: width * height * density * density };
}

test("pdfRasterDpr: a page that fits keeps the display's density", () => {
  // A Letter page at 适配宽度 in a 1200px-wide viewport is 1200 × 1553 CSS.
  assert.equal(pdfRasterDpr(2, 1200, 1553), 2);
  assert.equal(pdfRasterDpr(1, 1200, 1553), 1);
  // A 4K window at fit width: 3840 × 4970 at dpr 2 is 76 MP, so this one is over
  // the budget and must NOT come back as 2 — that is what the next test pins.
  assert.ok(pdfRasterDpr(2, 3840, 4970) < 2);
});

test("pdfRasterDpr: the ratio cap still applies below the budget", () => {
  assert.equal(pdfRasterDpr(3, 600, 800), PDF_MAX_DPR);
  assert.equal(pdfRasterDpr(2.5, 600, 800), PDF_MAX_DPR);
  // And a 3× display does not get a 3× bitmap just because the page is small.
  assert.ok(600 * 800 * pdfRasterDpr(3, 600, 800) ** 2 < PDF_MAX_PIXELS);
});

test("pdfRasterDpr: a page over the budget is backed off, never refused", () => {
  // A Letter page at PDF_MAX_SCALE (6) is 3672 × 4752 CSS — 70 MP at dpr 2.
  const letter = priced(3672, 4752, 2);
  assert.ok(letter.pixels <= PDF_MAX_PIXELS * (1 + 1e-9));
  assert.ok(letter.pixels > PDF_MAX_PIXELS * 0.99);
  assert.ok(letter.density > 0 && letter.density < 1, `${letter.density}`);

  // Even at dpr 1 the page is larger than the budget, so the answer is below 1:
  // soft pixels beat an allocation the browser may refuse.
  const flat = priced(12000, 18000, 1);
  assert.ok(flat.density < 1);
  assert.ok(flat.pixels <= PDF_MAX_PIXELS * (1 + 1e-9));
});

test("pdfRasterDpr: the budget holds across the whole zoom range", () => {
  const metrics = { width: 612, height: 792 };
  for (const scale of [0.25, 0.5, 1, 1.5, 2, 3, 4, 6]) {
    for (const dpr of [1, 1.5, 2, 3]) {
      const { pixels } = priced(
        metrics.width * scale,
        metrics.height * scale,
        dpr,
      );
      assert.ok(
        pixels <= PDF_MAX_PIXELS * (1 + 1e-9),
        `${scale}× at dpr ${dpr} is ${Math.round(pixels / 1e6)} MP`,
      );
    }
  }
});

test("pdfRasterDpr: degenerate input still answers a density", () => {
  // An unmeasured page (no size yet) keeps the display's density rather than
  // dividing by zero; a nonsense dpr is read as 1.
  assert.equal(pdfRasterDpr(2, 0, 0), 2);
  assert.equal(pdfRasterDpr(2, 0, 800), 2);
  assert.equal(pdfRasterDpr(0, 600, 800), 1);
  assert.equal(pdfRasterDpr(-1, 600, 800), 1);
  assert.equal(pdfRasterDpr(Number.NaN, 600, 800), 1);
});
