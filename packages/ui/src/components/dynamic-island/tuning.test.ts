// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The feel, pinned: the damping ratios that decide whether the island rings, the
 * speed lens that must move the clock without touching the shape, and the fact
 * that the console's patches are **validated** before they can reach a spring.
 *
 * These are the island's least visible numbers and the ones most likely to be
 * moved by hand, which is what makes them worth executing: `ringOf` in particular
 * is the derivation a threshold has to clear, and a wrong one shows up as a pill
 * that blinks rather than as a failing test — unless this file exists.
 *
 * Run with:
 *
 * ```sh
 * pnpm --filter=@workspace/ui test
 * ```
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyPatch,
  AUTHORED_TUNING,
  resolveMotion,
  ringOf,
  scaleSpring,
  sourceOf,
  type IslandSpring,
  type TuningPatch,
} from "./tuning.ts";
import { ISLAND_FORMS, type IslandForm } from "./forms.ts";
import { proximity, resolveGeometry } from "./geometry.ts";

/** Damping ratio: `1` is critically damped, below that the spring overshoots. */
function zeta(spring: IslandSpring): number {
  return spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
}

/** Natural frequency, in radians per second. */
function omega(spring: IslandSpring): number {
  return Math.sqrt(spring.stiffness / spring.mass);
}

function close(actual: number, expected: number, epsilon = 1e-12): void {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${actual} is not within ${epsilon} of ${expected}`,
  );
}

test("the collapse threshold clears the landing spring's own ring", () => {
  // The box rings past the pill as it lands, and `proximity` is a ratio, so an
  // undershoot of `u` reads as a distance of 1/(1-u) *again*. A threshold inside
  // that ring switches the pill on, off, on — so the ring is derived from the
  // spring itself rather than trusted to whoever moved the constant.
  const ring = ringOf(AUTHORED_TUNING.settle);

  close(ring, 1.0252, 5e-5);
  assert.ok(
    AUTHORED_TUNING.pillHandover > ring,
    `pillHandover (${AUTHORED_TUNING.pillHandover}) must clear the settle spring's ring (${ring.toFixed(4)})`,
  );
});

test("the ring belongs to the spring, and softening it opens the ring up", () => {
  // The under-damped morph spring rings much further out than the settle spring
  // does. That is no longer what keeps a collapse off `morph` — the shipped
  // threshold sits outside *both* rings — it is the depth of the dip: `morph`
  // undershoots by ~11%, which of a 340px preview is 38px under a 40px pill
  // (through the floor), against `settle`'s ~2.4% and 8px.
  const morph = ringOf(AUTHORED_TUNING.morph);
  assert.ok(morph > ringOf(AUTHORED_TUNING.settle));

  // Read back out of the ring rather than recomputed, so there is one
  // implementation of the undershoot in the package.
  const dip = (spring: IslandSpring): number => 1 - 1 / ringOf(spring);
  assert.ok(dip(AUTHORED_TUNING.morph) > 0.1);
  assert.ok(dip(AUTHORED_TUNING.settle) < 0.03);

  // …and a critically damped spring does not ring at all: `1` is "arrived".
  assert.equal(
    ringOf({ type: "spring", stiffness: 100, damping: 20, mass: 1 }),
    1,
  );
});

test("a collapse threshold only bites on a panel wider than its own value", () => {
  // `proximity` is a ratio measured against a fixed pill, so the distance a
  // collapse *starts* from is the panel's width over the pill's: 4.21 for
  // `search`, 2.71 for the narrower `preview`. A threshold at or past a form's
  // starting distance means the row owns the capsule from the first frame and
  // that form's body is never drawn while it collapses — a property of the
  // threshold and the form together, and the reason `pillHandover` cannot be
  // checked against the ring alone.
  const pill = { w: 133, h: 40 };
  const viewport = { w: 1280, h: 900 };
  const startingDistance = (form: IslandForm): number =>
    proximity(resolveGeometry(form, viewport, pill), pill);

  assert.ok(
    startingDistance(ISLAND_FORMS.search) > AUTHORED_TUNING.pillHandover,
  );
  assert.ok(
    startingDistance(ISLAND_FORMS.preview) < AUTHORED_TUNING.pillHandover,
  );
});

test("the speed lens moves the clock and holds the shape", () => {
  const rate = 0.25;
  const slow = scaleSpring(AUTHORED_TUNING.morph, rate);

  // ζ = c/(2√(km)): scaling stiffness by rate² and damping by rate is what keeps
  // a slow-motion pass from quietly becoming a bouncier spring.
  close(zeta(slow), zeta(AUTHORED_TUNING.morph));
  close(omega(AUTHORED_TUNING.morph) / omega(slow), 1 / rate);

  // …and it is the same lens `resolveMotion` puts on every spring it hands out.
  const motion = resolveMotion({ ...AUTHORED_TUNING, speed: rate });
  assert.deepEqual(motion.morph, slow);
  assert.deepEqual(motion.settle, scaleSpring(AUTHORED_TUNING.settle, rate));
  assert.deepEqual(
    motion.crossfade,
    scaleSpring(AUTHORED_TUNING.crossfade, rate),
  );
});

test("a default island and a tuned one resolve through the same path", () => {
  const motion = resolveMotion(AUTHORED_TUNING);

  // The three rows, straight from the authored numbers: a cut, a switch at the
  // pill, and the two dissolve windows.
  assert.deepEqual(motion.timing.grow, { in: "done", out: "done" });
  assert.deepEqual(motion.timing.shrink, {
    in: { at: AUTHORED_TUNING.pillHandover },
    out: { at: AUTHORED_TUNING.pillHandover },
  });
  assert.deepEqual(motion.timing.swap.in, AUTHORED_TUNING.swap.in);
  assert.deepEqual(motion.timing.swap.out, AUTHORED_TUNING.swap.out);

  // At the authored rate the springs are the authored springs, untouched.
  assert.deepEqual(motion.morph, AUTHORED_TUNING.morph);
  // …and the platform keeps deciding whether motion is cut short.
  assert.equal(motion.instant, null);
});

test("a patch moves what it names and nothing else", () => {
  const { tuning, rejected } = applyPatch(AUTHORED_TUNING, {
    morph: { stiffness: 200 },
    pillHandover: 1.12,
    swap: { in: { to: 1.4 } },
  });

  assert.deepEqual(rejected, []);
  assert.deepEqual(tuning.morph, {
    type: "spring",
    stiffness: 200,
    damping: AUTHORED_TUNING.morph.damping,
    mass: AUTHORED_TUNING.morph.mass,
  });
  assert.deepEqual(tuning.settle, AUTHORED_TUNING.settle);
  assert.deepEqual(tuning.crossfade, AUTHORED_TUNING.crossfade);
  assert.equal(tuning.speed, AUTHORED_TUNING.speed);
  assert.equal(tuning.pillHandover, 1.12);
  assert.deepEqual(tuning.swap.in, { from: 3.2, to: 1.4 });
  assert.deepEqual(tuning.swap.out, AUTHORED_TUNING.swap.out);

  // And the threshold a collapse switches at is the tuned one, not the constant.
  assert.deepEqual(resolveMotion(tuning).timing.shrink.in, { at: 1.12 });
});

test("a number that cannot run is refused, and keeps the one it had", () => {
  const cases: readonly { patch: TuningPatch; path: string }[] = [
    { patch: { speed: 0 }, path: "speed" },
    { patch: { speed: Number.NaN }, path: "speed" },
    // Below 1 the switch could never fire: `proximity` is a ratio, and a ratio
    // cannot read as nearer than arrived.
    { patch: { pillHandover: 1 }, path: "pillHandover" },
    { patch: { morph: { stiffness: -1 } }, path: "morph.stiffness" },
    { patch: { morph: { mass: 0 } }, path: "morph.mass" },
    {
      patch: { settle: { damping: Number.POSITIVE_INFINITY } },
      path: "settle.damping",
    },
    // `layerOpacity` divides by the span, so an inverted window has no ramp.
    { patch: { swap: { in: { to: 9 } } }, path: "swap.in.to" },
    { patch: { swap: { out: { from: 0 } } }, path: "swap.out.from" },
  ];

  for (const { patch, path } of cases) {
    const { tuning, rejected } = applyPatch(AUTHORED_TUNING, patch);
    assert.equal(rejected.length, 1, `${path}: expected one refusal`);
    assert.match(
      rejected[0] ?? "",
      new RegExp(`^${path.replace(".", "\\.")} `),
    );
    // The refused field kept its previous value, so the island stayed lookable.
    assert.deepEqual(tuning, AUTHORED_TUNING);
  }
});

test("a stored tuning is validated exactly like a console patch", () => {
  const tuned = applyPatch(AUTHORED_TUNING, {
    settle: { damping: 18 },
    speed: 0.5,
    instant: false,
  });
  assert.deepEqual(tuned.rejected, []);
  assert.equal(tuned.tuning.instant, false);

  // `localStorage` hands back JSON, which is exactly the shape of a patch — and
  // a hand-edited entry has to survive the same checks.
  const restored = applyPatch(
    AUTHORED_TUNING,
    JSON.parse(JSON.stringify(tuned.tuning)) as TuningPatch,
  );
  assert.deepEqual(restored.rejected, []);
  assert.deepEqual(restored.tuning, tuned.tuning);

  const garbage = applyPatch(AUTHORED_TUNING, {
    instant: "yes",
  } as unknown as TuningPatch);
  assert.equal(garbage.tuning.instant, AUTHORED_TUNING.instant);
  assert.equal(garbage.rejected.length, 1);
});

test("the snippet prints the springs at the rate that was watched", () => {
  const rate = 2;
  const snippet = sourceOf({ ...AUTHORED_TUNING, speed: rate });
  const morph = scaleSpring(AUTHORED_TUNING.morph, rate);

  // The *effective* numbers, not the stored ones: pasting what the eye approved
  // is the entire point of the round trip (`sourceOf` writing the stored springs
  // would silently discard the lens).
  const line =
    `const MORPH: IslandSpring = { type: "spring", stiffness: ${morph.stiffness}, ` +
    `damping: ${morph.damping}, mass: ${morph.mass} };`;
  assert.ok(snippet.includes(line), snippet);
  assert.ok(snippet.includes(`printed at speed ${rate}`));

  // A threshold and a dissolve window are not rates, so they print as authored.
  assert.ok(
    snippet.includes(`const PILL_HANDOVER = ${AUTHORED_TUNING.pillHandover};`),
  );
  assert.ok(
    snippet.includes(
      `from: ${AUTHORED_TUNING.swap.in.from}, to: ${AUTHORED_TUNING.swap.in.to}`,
    ),
  );

  // Every line names a constant `tuning.ts` really declares, so a rename cannot
  // leave the console handing out a snippet that does not compile.
  for (const name of [
    "MORPH",
    "SETTLE",
    "CROSSFADE",
    "SWAP_WINDOW",
    "PILL_HANDOVER",
  ]) {
    assert.ok(snippet.includes(`const ${name}`), `snippet is missing ${name}`);
  }

  // At the authored rate there is no lens to explain away.
  assert.ok(!sourceOf(AUTHORED_TUNING).includes("speed"));
});
