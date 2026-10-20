// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The content swap, pinned: *when* a body takes the capsule over from another,
 * and — just as load-bearing — that the layer being left keeps its **key**.
 *
 * The timings under test are the ones the shell actually runs: `resolveMotion` of
 * the authored tuning, not a second copy of them, so a number moved in
 * `tuning.ts` moves these expectations with it. The springs themselves — their
 * damping ratios, the ring a landing spring overshoots back out to, and the speed
 * lens — are `tuning.test.ts`.
 *
 * The timings say when content changes; `promote` says whether the element
 * survives the change. Only the two together produce a dissolve at all, and the
 * second one is invisible in a screenshot, which is exactly why it is tested
 * here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { handoverFor } from "./forms.ts";
import { layerOpacity } from "./geometry.ts";
import { promote, type LayerStack } from "./layers.ts";
import { AUTHORED_TUNING, resolveMotion } from "./tuning.ts";

/** The table a default island runs — the same call `useIslandMotion` makes. */
const TIMING = resolveMotion(AUTHORED_TUNING).timing;

const START: LayerStack = {
  incoming: { id: 0, panel: "idle", role: "in" },
  outgoing: [],
  layers: [{ id: 0, panel: "idle", role: "in" }],
  nextId: 1,
  for: "idle",
};

test("a demotion keeps the layer's key, so React keeps its instance", () => {
  const next = promote(START, "search");

  // Same id ⇒ same key ⇒ the same component instance, whose opacity spring was
  // already at 1 and can therefore fade out. A fresh mount would start at its
  // target (0) and the swap could only ever be a cut.
  assert.equal(next.outgoing[0]?.id, START.incoming.id);
  assert.equal(next.outgoing[0]?.role, "out");
  // …while the incoming form is always a new entry.
  assert.notEqual(next.incoming.id, START.incoming.id);
  assert.equal(next.incoming.panel, "search");
});

test("the rendered list is one flat array, outgoing first and incoming last", () => {
  const next = promote(START, "search");
  assert.deepEqual(
    next.layers.map((layer) => [layer.id, layer.role]),
    [
      [0, "out"],
      [1, "in"],
    ],
  );
  assert.equal(next.layers.at(-1), next.incoming);
});

test("expanding drops the pill's row before the motion starts", () => {
  const { in: incoming, out: outgoing } = TIMING.grow;

  // The island grows *with* the panel's body: the row is already gone on the
  // first frame, at whatever distance the growth happens to start from.
  assert.equal(layerOpacity(11, "in", incoming), 1);
  assert.equal(layerOpacity(2, "in", incoming), 1);
  assert.equal(layerOpacity(11, "out", outgoing), 0);
  assert.equal(layerOpacity(1.2, "out", outgoing), 0);
});

test("a collapse hands the capsule back to the row part-way down", () => {
  const handover = AUTHORED_TUNING.pillHandover;
  const outgoing = (distance: number) =>
    layerOpacity(distance, "out", TIMING.shrink.out);
  const incoming = (distance: number) =>
    layerOpacity(distance, "in", TIMING.shrink.in);

  // The panel is opaque while the box is still outside the threshold — which is
  // most of the *width* it has to give up, so it is seen shrinking.
  assert.equal(outgoing(4.21), 1);
  assert.equal(outgoing(handover + 0.01), 1);
  assert.equal(incoming(4.21), 0);
  assert.equal(incoming(handover + 0.01), 0);

  // …and the row owns the capsule from the moment the box is inside it. That is
  // before the box has arrived: the rest of the descent is the pill's own frame
  // springing home under a row that is already on screen.
  assert.equal(outgoing(handover - 0.01), 0);
  assert.equal(outgoing(1.5), 0);
  assert.equal(incoming(handover - 0.01), 1);
  assert.equal(incoming(1), 1);
});

test("a panel change with no size change is a dissolve, not a cut", () => {
  // `search` and `agent` share a box, so the distance is already 1 on the first
  // frame: the incoming body is opaque immediately, and the outgoing one has to
  // do the fading on its own — which is only possible because it was not
  // remounted.
  assert.equal(layerOpacity(1, "in", TIMING.swap.in), 1);
  assert.equal(layerOpacity(1, "out", TIMING.swap.out), 0);
});

test("a panel-to-panel move dissolves through the middle of the growth", () => {
  const incoming = (distance: number) =>
    layerOpacity(distance, "in", TIMING.swap.in);
  const outgoing = (distance: number) =>
    layerOpacity(distance, "out", TIMING.swap.out);

  assert.equal(incoming(4.2), 0);
  assert.ok(Math.abs(incoming((3.2 + 1.15) / 2) - 0.5) < 1e-9);
  assert.equal(incoming(1.15), 1);

  // The outgoing body lets go from the same far edge but finishes sooner, so it
  // is never the one still on screen by the time the incoming body has arrived.
  assert.equal(outgoing(3.2), 1);
  assert.ok(Math.abs(outgoing(2.4) - 0.5) < 1e-9);
  assert.equal(outgoing(1.6), 0);
});

test("the move decides the timing — not which side of it the pill is on", () => {
  // Expanding out of the pill: the panel owns the capsule from the first frame.
  assert.deepEqual(handoverFor("idle", "search", TIMING), TIMING.grow);
  // Collapsing into it: the panel is held until the box *is* the pill.
  assert.deepEqual(handoverFor("search", "idle", TIMING), TIMING.shrink);
  // Two panels: neither is the pill, so there is nothing to time against.
  assert.deepEqual(handoverFor("search", "agent", TIMING), TIMING.swap);
  assert.deepEqual(handoverFor("search", "preview", TIMING), TIMING.swap);
  assert.deepEqual(handoverFor("preview", "search", TIMING), TIMING.swap);
  // A body on its own has nothing to hand over from, so nothing may fade —
  // including the pill, which must not dim when its own width is re-measured.
  assert.deepEqual(handoverFor(undefined, "idle", TIMING), TIMING.grow);
  assert.deepEqual(handoverFor(undefined, "search", TIMING), TIMING.grow);
});

test("retargeting mid-flight keeps the intermediate layer mounted", () => {
  const one = promote(START, "search");
  const two = promote(one, "agent");

  // The idle pill is still on its way out when `agent` arrives; dropping it here
  // would pop a half-visible layer off the screen.
  assert.equal(two.outgoing.length, 2);
  assert.deepEqual(
    two.outgoing.map((layer) => layer.panel),
    ["idle", "search"],
  );
  assert.equal(two.incoming.panel, "agent");

  // …and the newest demotion is the move the timing is decided from: this is a
  // panel-to-panel dissolve, *not* a second expansion out of the pill, even
  // though an idle layer is still in the list. (`layers.at(-2)` is exactly the
  // expression the shell reads it from.)
  assert.deepEqual(
    handoverFor(two.layers.at(-2)?.panel, "agent", TIMING),
    TIMING.swap,
  );
});

test("the oldest outgoing layer is dropped once the cap is reached", () => {
  const three = promote(promote(promote(START, "search"), "agent"), "preview");
  assert.deepEqual(
    three.outgoing.map((layer) => layer.panel),
    ["search", "agent"],
  );
});
