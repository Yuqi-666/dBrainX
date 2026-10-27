// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pins the pdf's viewport-gesture arithmetic — see `pdf-gesture.ts` for why it is
 * a separate module and `pdf-zoom.test.ts` for the zoom-deferral policy next to
 * it.
 *
 * Run with `pnpm --filter=@workspace/ui test` (Node's own test runner over the
 * type-stripped sources, so the import carries a `.ts` specifier).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PDF_MAX_SCALE, PDF_MIN_SCALE } from "./types.ts";
import { pdfIsInitialView, pdfPinchFrame } from "./pdf-gesture.ts";

const anchor = {
  scale: 1,
  spread: 100,
  midX: 300,
  midY: 400,
  scrollLeft: 0,
  scrollTop: 1000,
};
/** The scroller's viewport starts at (0, 0) for these cases: client = offset. */
const origin = { x: 0, y: 0 };

/** The content coordinate the fingers are on, after a frame. */
function anchoredPoint(
  frame: { scrollTop: number; scale: number },
  midY: number,
): number {
  return (frame.scrollTop + midY) / frame.scale;
}

test("a pinch scales by the finger-spread ratio", () => {
  const frame = pdfPinchFrame(
    anchor,
    { spread: 200, midX: 300, midY: 400 },
    origin,
  );
  assert.ok(frame);
  assert.equal(frame.scale, 2);
  // Nothing moved: a symmetric pinch must not scroll the document, and the point
  // under the fingers must be the same piece of paper at twice the size.
  // The fingers are 300/400 px from the viewport's corner, so doubling the paper
  // also moves the offset — what must not move is the paper *under* them.
  assert.equal(frame.scrollLeft, 300);
  assert.equal(frame.scrollTop, 2400);
  assert.equal(anchoredPoint(frame, 400), anchoredPoint(anchor, 400));
});

test("a pinch that closes zooms out by the same ratio", () => {
  const frame = pdfPinchFrame(
    anchor,
    { spread: 50, midX: 300, midY: 400 },
    origin,
  );
  assert.ok(frame);
  assert.equal(frame.scale, 0.5);
  assert.equal(anchoredPoint(frame, 400), anchoredPoint(anchor, 400));
});

test("every frame of one pinch keeps the same piece of paper under the fingers", () => {
  // The regression this pins: with a frame that carried only the midpoint travel,
  // the viewer's zoom anchor re-scaled the *current* offset instead of the anchor's,
  // so from the second frame on the page slid away by `scale / anchorScale` per
  // frame. Composing every frame from the anchor makes that impossible.
  const start = { ...anchor, scrollTop: 1000 };
  const fixedMid = { midX: 300, midY: 400 };
  const expected = anchoredPoint(anchor, 400);
  for (const spread of [110, 140, 200, 320, 500]) {
    const frame = pdfPinchFrame(start, { ...fixedMid, spread }, origin);
    assert.ok(frame);
    assert.equal(
      anchoredPoint(frame, 400),
      expected,
      `spread ${spread} moved the anchored point`,
    );
  }
});

test("the midpoint moves the paper with the fingers", () => {
  // The fingers slide right by 30 and up by 12 while keeping their distance: the
  // content must move with them, i.e. a smaller offset on the axis they moved
  // *towards* and a larger one on the axis they left.
  const frame = pdfPinchFrame(
    anchor,
    { spread: 100, midX: 330, midY: 388 },
    origin,
  );
  assert.ok(frame);
  assert.equal(frame.scale, 1);
  assert.equal(frame.scrollLeft, -30);
  assert.equal(frame.scrollTop, 1012);
});

test("a frame is absolute: applying the same one twice cannot accumulate", () => {
  // The regression this pins: as a delta, every sample of a two-finger drag would
  // re-apply the whole travel from the anchor (100px of finger movement scrolling
  // the strip by 100 × the sample count).
  const current = { spread: 100, midX: 400, midY: 400 };
  const first = pdfPinchFrame(anchor, current, origin);
  const second = pdfPinchFrame(anchor, current, origin);
  assert.ok(first && second);
  assert.deepEqual(first, second);
  assert.equal(first.scrollLeft, -100);
});

test("a pinch composes zoom and pan in the same frame", () => {
  const frame = pdfPinchFrame(
    { ...anchor, scale: 1.5, spread: 80, midX: 100, midY: 100 },
    { spread: 160, midX: 140, midY: 90 },
    origin,
  );
  assert.ok(frame);
  assert.equal(frame.scale, 3);
  // The anchored point (scroll 1000 + mid 100 = 1100, at scale 1.5) lands at twice
  // its coordinate, minus where the fingers are now (140 / 90).
  assert.equal(frame.scrollLeft, 60);
  assert.equal(frame.scrollTop, 2110);
  assert.equal(anchoredPoint(frame, 90), (1000 + 100) / 1.5);
});

test("the multiplier is clamped to the viewer's own limits", () => {
  // Against `types.ts`'s constants rather than this module's copies of them: the
  // maths re-states the two numbers so that `node --test` can load it without a
  // `.ts` import, and this is what keeps the re-statement honest.
  const far = pdfPinchFrame(
    anchor,
    { spread: 100_000, midX: 0, midY: 0 },
    origin,
  );
  assert.ok(far);
  assert.equal(far.scale, PDF_MAX_SCALE);

  const near = pdfPinchFrame(
    anchor,
    { spread: 0.01, midX: 0, midY: 0 },
    origin,
  );
  assert.ok(near);
  assert.equal(near.scale, PDF_MIN_SCALE);
});

test("a degenerate pinch decides nothing", () => {
  // Two fingers exactly on top of each other: the ratio would be Infinity, and
  // applying it would leave the document unusable rather than un-zoomed.
  const bad = (
    anchorValue: typeof anchor,
    current: Parameters<typeof pdfPinchFrame>[1],
  ) => pdfPinchFrame(anchorValue, current, origin);
  assert.equal(bad(anchor, { spread: 0, midX: 1, midY: 2 }), null);
  assert.equal(
    bad({ ...anchor, spread: 0 }, { spread: 10, midX: 1, midY: 2 }),
    null,
  );
  assert.equal(bad(anchor, { spread: Number.NaN, midX: 1, midY: 2 }), null);
  assert.equal(
    bad({ ...anchor, scale: Number.NaN }, { spread: 10, midX: 1, midY: 2 }),
    null,
  );
  assert.equal(bad(anchor, { spread: 10, midX: Number.NaN, midY: 2 }), null);
  // An unmeasurable viewport is not a pinch either: every offset would be wrong.
  assert.equal(
    pdfPinchFrame(
      anchor,
      { spread: 10, midX: 1, midY: 2 },
      {
        x: Number.NaN,
        y: 0,
      },
    ),
    null,
  );
});

test("re-anchoring mid-pinch keeps the frame relative to the new anchor", () => {
  // Lifting one of three fingers re-anchors: the next frame must be measured
  // against the fingers that are still down, not against the pair that left —
  // including the offset, which is why the anchor carries it.
  const reanchored = {
    scale: 2,
    spread: 60,
    midX: 500,
    midY: 500,
    scrollLeft: 200,
    scrollTop: 300,
  };
  const frame = pdfPinchFrame(
    reanchored,
    { spread: 120, midX: 500, midY: 500 },
    origin,
  );
  assert.ok(frame);
  assert.equal(frame.scale, 4);
  // Re-anchored at scroll (200, 300) with the fingers 500/500 from the corner: the
  // new frame keeps *that* paper under them, at twice the size.
  assert.equal(frame.scrollLeft, 900);
  assert.equal(frame.scrollTop, 1100);
});

test("the opening view is a multiplier, resolved for the current viewport", () => {
  const opening = { scale: 0.9, fit: "width" };
  // A resize changes what 适配宽度 resolves to; the reader is still at the opening
  // view, so the pill must stay hidden.
  assert.equal(pdfIsInitialView(1.4, opening, 1.4), true);
  // Zooming is leaving it.
  assert.equal(pdfIsInitialView(2, opening, 0.9), false);
  // So is another fit mode that resolves differently.
  assert.equal(pdfIsInitialView(0.7, opening, 0.9), false);
});

test("picking the very same multiplier is still the opening view", () => {
  // The toolbar's scale list sets `free` at whatever the reader picked; picking the
  // number the opening fit already resolves to changes nothing on screen, so a pill
  // offering to undo it would be chrome for a no-op.
  assert.equal(pdfIsInitialView(0.9, { scale: 0.9, fit: "width" }, 0.9), true);
});

test("a free opening view compares its own number, with the same epsilon", () => {
  const opening = { scale: 1.25, fit: "free" };
  assert.equal(pdfIsInitialView(1.25, opening, 99), true);
  assert.equal(pdfIsInitialView(1.2505, opening, 99), true);
  assert.equal(pdfIsInitialView(1.3, opening, 99), false);
  assert.equal(pdfIsInitialView(0.5, opening, 99), false);
});
