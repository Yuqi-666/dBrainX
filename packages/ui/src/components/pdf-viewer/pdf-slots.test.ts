// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";

import {
  pdfSlotOf,
  pdfSlotStartPage,
  pdfSlots,
  pdfSpreadStep,
  pdfSurfacedPages,
} from "./types.ts";

/** Every page the strip holds, in slot order. */
function slotPages(pageCount: number, spread: "single" | "double"): number[][] {
  return pdfSlots(pageCount, spread).map((slot) => slot.pages);
}

test("pdfSpreadStep: 单页 holds one page, 双页 holds two", () => {
  assert.equal(pdfSpreadStep("single"), 1);
  assert.equal(pdfSpreadStep("double"), 2);
});

test("pdfSlots: 单页 is one page per slot", () => {
  assert.deepEqual(slotPages(4, "single"), [[1], [2], [3], [4]]);
});

test("pdfSlots: 双页 pairs consecutive pages, left then right", () => {
  assert.deepEqual(slotPages(4, "double"), [
    [1, 2],
    [3, 4],
  ]);
});

test("pdfSlots: 双页 leaves an odd last page on its own", () => {
  assert.deepEqual(slotPages(5, "double"), [[1, 2], [3, 4], [5]]);
});

test("pdfSlots: an empty document has no slots", () => {
  assert.deepEqual(pdfSlots(0, "double"), []);
});

test("pdfSlots: slots are numbered from 1, in order", () => {
  assert.deepEqual(
    pdfSlots(5, "double").map((slot) => slot.index),
    [1, 2, 3],
  );
});

test("pdfSlotOf: a page names the slot that shows it", () => {
  assert.equal(pdfSlotOf(1, "double"), 1);
  assert.equal(pdfSlotOf(2, "double"), 1);
  assert.equal(pdfSlotOf(3, "double"), 2);
  assert.equal(pdfSlotOf(4, "double"), 2);
  assert.equal(pdfSlotOf(4, "single"), 4);
});

test("pdfSlotStartPage: every page normalises to its slot's leading page", () => {
  const leading = (page: number) =>
    pdfSlotStartPage(pdfSlotOf(page, "double"), "double");
  assert.deepEqual([1, 2, 3, 4, 5].map(leading), [1, 1, 3, 3, 5]);
  // 单页 is the identity, so the same call is safe in both modes.
  const identity = (page: number) =>
    pdfSlotStartPage(pdfSlotOf(page, "single"), "single");
  assert.deepEqual([1, 2, 3, 4, 5].map(identity), [1, 2, 3, 4, 5]);
});

test("pdfSlotStartPage: the leading page is the first page of that slot", () => {
  for (const spread of ["single", "double"] as const) {
    for (const slot of pdfSlots(9, spread)) {
      assert.equal(
        pdfSlotStartPage(slot.index, spread),
        slot.pages[0],
        `${spread} slot ${slot.index}`,
      );
      assert.equal(pdfSlotOf(slot.pages[0]!, spread), slot.index);
    }
  }
});

test("pdfSurfacedPages: a page is asked about by its slot, not by its number", () => {
  // 双页 slot 2 holds pages 3 and 4, so putting that *slot* in the window surfaces
  // both pages. The tempting version — `visibleSlots.has(page)` — returns false for
  // both (neither 3 nor 4 is the number 2) and would leave the right-hand page of
  // every spread without ink.
  assert.deepEqual(
    pdfSurfacedPages([1, 2, 3, 4, 5], new Set([2]), "double"),
    [3, 4],
  );
  assert.deepEqual(
    pdfSurfacedPages([1, 2, 3, 4, 5], new Set([1, 3]), "double"),
    [1, 2, 5],
  );
});

test("pdfSurfacedPages: 单页 is the identity mapping", () => {
  assert.deepEqual(pdfSurfacedPages([1, 2, 3], new Set([2]), "single"), [2]);
  assert.deepEqual(pdfSurfacedPages([1, 2, 3], new Set(), "single"), []);
});

test("pdfSurfacedPages: keeps the order it was given and drops unknown pages", () => {
  // The viewer hands it a Map's keys, i.e. mount order, and the layer keys its
  // canvases by page — so the filter must not sort or invent anything.
  assert.deepEqual(
    pdfSurfacedPages([4, 1, 3], new Set([1, 2, 3]), "double"),
    [4, 1, 3],
  );
});
