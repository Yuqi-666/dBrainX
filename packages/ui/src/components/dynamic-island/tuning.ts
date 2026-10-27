// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The island's **feel**, as numbers: the three springs it runs, the rate they run
 * at, and the thresholds its content changes hands at.
 *
 * It is a module of its own — and a *pure* one, import-free at runtime, like
 * `geometry.ts` — for two reasons:
 *
 * 1. These are the numbers no screenshot can assert, so `tuning.test.ts` executes
 *    them under `node --test`: a damping ratio, the ring a landing spring
 *    overshoots back out to, and the fact that a speed change must keep a
 *    spring's *shape*.
 * 2. They are the numbers one wants to move while watching the island, which is
 *    why `use-tuning.ts` — the store, the hook and the browser console — *drives*
 *    this file instead of duplicating it. The default path is
 *    `resolveMotion(AUTHORED_TUNING)` and a tuned path is `resolveMotion(tuned)`,
 *    so a number found by hand at runtime cannot behave differently from the one
 *    committed here.
 */

import type { Transition } from "motion/react";

import type { SwapTiming } from "./forms";
import type { Fade, LayerSide } from "./geometry";

/** A spring's numbers, without motion's discriminant. */
export interface SpringNumbers {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/**
 * A spring as the island authors and tunes it. `"spring"` is a literal rather
 * than an optional field so the numbers are always readable as numbers — the
 * tuner does arithmetic on them — while the object is still a `Transition` and
 * can be handed to `animate()` untouched.
 */
export interface IslandSpring extends SpringNumbers {
  readonly type: "spring";
}

/**
 * The morph spring. Deliberately under-damped (ζ ≈ 0.57), so the capsule
 * overshoots a little and settles — the "liquid" part of the effect.
 */
const MORPH: IslandSpring = {
  type: "spring",
  stiffness: 440,
  damping: 24,
  mass: 1,
};

/**
 * The same spring, damped enough to swallow its own undershoot (ζ ≈ 0.76), used
 * for `expanded → idle`.
 *
 * The under-damped spring overshoots by ~11%: desirable while the island *grows*
 * (there is nothing above it to break), disastrous on the way down — 11% of a
 * 400px collapse is 45px below a 40px pill, so the island squashes through a
 * hairline before springing back. ~2.4% overshoot still reads as liquid and
 * never as a disappearing island. The 2.4% is also what {@link ringOf} reads
 * back out of these three numbers for every threshold that has to clear it.
 */
const SETTLE: IslandSpring = {
  type: "spring",
  stiffness: 440,
  damping: 32,
  mass: 1,
};

/**
 * The content cross-fade: a stiff spring, because while the box is moving the
 * swap is already a function of the box — all this does is round its corners.
 * Two hand-overs have nothing but this spring to be smooth: the hard switch a
 * collapse ends with (`timingOf`'s `shrink` row) and a panel change with no size
 * change at all (`search ⇄ agent`), where it is the entire transition.
 */
const CROSSFADE: IslandSpring = {
  type: "spring",
  stiffness: 1280,
  damping: 60,
  mass: 0.9,
};

/**
 * The `swap` row's dissolve: the proximity interval each side fades over. The
 * outgoing body lets go from the same far edge but finishes sooner (`to` = 1.6
 * against the incoming 1.15), so it is never still on screen once the incoming
 * one has arrived.
 */
const SWAP_WINDOW: Readonly<Record<LayerSide, Fade>> = {
  in: { from: 3.2, to: 1.15 },
  out: { from: 3.2, to: 1.6 },
};

/**
 * Where a collapse hands the capsule back to the pill, as proximity: the row
 * takes over once the box is within **three times** the pill's width — 400px of
 * a 133px pill, about a third of the way down a `search`-sized collapse.
 *
 * Above `1` this is a choice about *how much of the collapse is the panel*, and
 * the panel's own width decides which side of it a form falls on, because
 * `proximity` is a ratio measured against a fixed pill. A form wider than
 * `3 × pill` (`search` / `agent`, 560 against 133) starts at 4.21, so its body is
 * on screen for the first ~113ms and the row owns the rest of the descent; a
 * form *narrower* than that (`preview`, 360 against 133) starts at 2.71 — already
 * inside the threshold — so a collapse never draws its body at all. `1.06`, the
 * value this replaced, was "the panel is seen the whole way down" for every
 * form. Tune it in the console and watch which form it lands between;
 * `tuning.test.ts` checks both sides of that boundary.
 *
 * It still has to clear the collapse spring's own {@link ringOf ring}. `SETTLE`
 * undershoots by 2.5% and `proximity` is a ratio, so the box reads as 1.026 away
 * again as it rings; a threshold inside that ring would switch the panel off,
 * back on, and off again. At `3` the ring is no longer the binding constraint —
 * the form's starting distance is.
 */
const PILL_HANDOVER = 3;

/** Everything the morph can be moved with. */
export interface IslandTuning {
  readonly morph: IslandSpring;
  readonly settle: IslandSpring;
  readonly crossfade: IslandSpring;
  /**
   * The **rate** the springs run at: `1` is authored, `0.25` is quarter speed
   * (four times slower, which is what makes a 300ms hand-over watchable).
   */
  readonly speed: number;
  /** See {@link PILL_HANDOVER}. */
  readonly pillHandover: number;
  /** The `swap` row's window, per side. */
  readonly swap: Readonly<Record<LayerSide, Fade>>;
  /**
   * `null` follows the platform's reduced-motion setting. `true` / `false` force
   * the hard cut on or off, which is the only way to review that path without
   * changing an OS preference and restarting the browser.
   */
  readonly instant: boolean | null;
}

/**
 * The tuning the island ships with — the one authored copy, and the thing a
 * runtime experiment gets pasted back into (`__island.copy()` prints exactly
 * these lines).
 *
 * The springs are a hand-tuned session committed the way it was watched: it ran
 * at `speed: 2`, and `sourceOf` bakes the rate into the printed springs, so they
 * are four times the stiffness the design started from with their damping
 * ratios intact (ζ ≈ 0.57 / 0.76 / 0.88). `speed` is back to `1` — these *are*
 * the authored numbers now, and there is no double-speed left in the shelf.
 */
export const AUTHORED_TUNING: IslandTuning = {
  morph: MORPH,
  settle: SETTLE,
  crossfade: CROSSFADE,
  speed: 1,
  pillHandover: PILL_HANDOVER,
  swap: SWAP_WINDOW,
  instant: null,
};

/**
 * A partial tuning, as the console receives one: only what moved.
 *
 * It is typed structurally rather than as `Partial<IslandTuning>` so a spring
 * patch cannot carry a `type` (there is one spring transition in this island and
 * it is not a tween), and so the console's own completion is useful: `{` lists
 * the knobs, not a whole tree.
 */
export interface TuningPatch {
  readonly morph?: Partial<SpringNumbers>;
  readonly settle?: Partial<SpringNumbers>;
  readonly crossfade?: Partial<SpringNumbers>;
  readonly speed?: number;
  readonly pillHandover?: number;
  readonly swap?: {
    readonly in?: Partial<Fade>;
    readonly out?: Partial<Fade>;
  };
  readonly instant?: boolean | null;
}

/** What a patch produced, and what it asked for and did not get. */
export interface AppliedTuning {
  readonly tuning: IslandTuning;
  /** One line per refused value, for whoever typed it. */
  readonly rejected: readonly string[];
}

/**
 * Fold a patch into a tuning, **refusing** what cannot run instead of poisoning
 * the whole thing: a mistyped field keeps its previous value and says so, which
 * matters because the console is exactly where typos happen and the island has
 * to stay observable while one is being fixed.
 *
 * An unknown value is refused too — the tuner can be handed a `JSON.parse` of a
 * hand-edited `localStorage` entry, so every leaf is checked at runtime and not
 * merely typed.
 */
export function applyPatch(
  current: IslandTuning,
  patch: TuningPatch,
): AppliedTuning {
  const rejected: string[] = [];

  const spring = (
    base: IslandSpring,
    asked: Partial<SpringNumbers> | undefined,
    path: string,
  ): IslandSpring => ({
    type: "spring",
    stiffness: number(
      rejected,
      `${path}.stiffness`,
      asked?.stiffness,
      (n) => n > 0,
      base.stiffness,
    ),
    damping: number(
      rejected,
      `${path}.damping`,
      asked?.damping,
      (n) => n >= 0,
      base.damping,
    ),
    mass: number(
      rejected,
      `${path}.mass`,
      asked?.mass,
      (n) => n > 0,
      base.mass,
    ),
  });

  const dissolve = (
    base: Fade,
    asked: Partial<Fade> | undefined,
    path: string,
  ): Fade => {
    const from = number(
      rejected,
      `${path}.from`,
      asked?.from,
      (n) => n > 0,
      base.from,
    );
    // `from > to` is not taste, it is what makes the ramp's denominator
    // positive: `layerOpacity` divides by the span.
    const to = number(
      rejected,
      `${path}.to`,
      asked?.to,
      (n) => n >= 0 && n < from,
      base.to,
    );
    return { from, to };
  };

  return {
    tuning: {
      morph: spring(current.morph, patch.morph, "morph"),
      settle: spring(current.settle, patch.settle, "settle"),
      crossfade: spring(current.crossfade, patch.crossfade, "crossfade"),
      speed: number(
        rejected,
        "speed",
        patch.speed,
        (n) => n > 0,
        current.speed,
      ),
      // Below 1 the switch can never fire: `proximity` is a ratio, and a ratio
      // cannot read as nearer than arrived.
      pillHandover: number(
        rejected,
        "pillHandover",
        patch.pillHandover,
        (n) => n > 1,
        current.pillHandover,
      ),
      swap: {
        in: dissolve(current.swap.in, patch.swap?.in, "swap.in"),
        out: dissolve(current.swap.out, patch.swap?.out, "swap.out"),
      },
      instant: instantOr(rejected, current.instant, patch.instant),
    },
    rejected,
  };
}

/**
 * The same spring at `rate` times the speed, with its damping **ratio** held.
 *
 * The natural frequency is `√(k/m)`, so `k × rate²` scales the frequency by
 * `rate` — and ζ is `c / (2√(km))`, so `c` has to travel with it for the shape
 * to survive. Scaling one without the other would turn "play this slower" into
 * "make this bouncier", which is not something a debug knob may do quietly.
 */
export function scaleSpring(spring: IslandSpring, rate: number): IslandSpring {
  return {
    type: "spring",
    stiffness: spring.stiffness * rate * rate,
    damping: spring.damping * rate,
    mass: spring.mass,
  };
}

/**
 * How far out the box **rings back to** as an under-damped spring lands, derived
 * from the spring's own numbers rather than trusted to whoever tuned a
 * threshold.
 *
 * A landing spring undershoots its target by `u`, and `proximity` is a ratio, so
 * the box reads as `1/(1-u)` away again — the distance a hand-over threshold has
 * to clear to avoid switching the pill off, on and off again. A spring that is
 * critically damped or worse has no ring at all, hence `1`.
 */
export function ringOf(spring: IslandSpring): number {
  const zeta = spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
  if (!(zeta < 1)) return 1;
  const undershoot = Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
  return 1 / (1 - undershoot);
}

/**
 * **When** one body takes the capsule over from the other, per direction, from
 * the two numbers that decide it.
 *
 * Expanding and collapsing want opposite things out of the same measurement,
 * which is why this is a table and not one curve:
 *
 * - **`grow`** (`idle → any panel`): the hand-over is *over* before the motion
 *   starts. The pill's row is gone on the first frame and the panel's body is
 *   what the island grows with. Holding the row to the end is not an option
 *   either — `layerScale` clamps a leaving layer at its natural size (blowing a
 *   40px row up to 560px would be absurd), so the alternative is a pill-sized
 *   row marooned in the middle of a growing empty capsule while the dissolve
 *   catches up, which is the thing this timing exists to remove.
 * - **`shrink`** (`any panel → idle`): the panel holds the capsule until the box
 *   is inside `pillHandover`, and the row takes over from there. With the
 *   shipped threshold that switch happens part-way down, so the panel is *seen*
 *   starting to shrink and the pill's own frame owns the rest of the descent.
 *   The opacity spring rounds that switch into a short dissolve.
 * - **`swap`** (`panel → panel`): neither body is the pill, so there is nothing
 *   to time the change against, and the two dissolve through the middle of the
 *   move instead.
 *
 * Tuning these rows is tuning the whole feel of the swap.
 */
export function timingOf(
  pillHandover: number,
  window: Readonly<Record<LayerSide, Fade>>,
): SwapTiming {
  return {
    grow: { in: "done", out: "done" },
    shrink: { in: { at: pillHandover }, out: { at: pillHandover } },
    swap: { in: window.in, out: window.out },
  };
}

/** What the island actually runs, with every knob already folded in. */
export interface IslandMotion {
  readonly morph: Transition;
  readonly settle: Transition;
  readonly crossfade: Transition;
  readonly timing: SwapTiming;
  /** `null` = follow the platform; see {@link IslandTuning.instant}. */
  readonly instant: boolean | null;
}

/**
 * The one and only conversion from numbers to motion: three springs at their
 * tuned rate and the hand-over table they imply.
 *
 * Nothing else in the island builds a `Transition` or a timing table, so a tuned
 * island cannot take a different path through the code than a committed one does.
 */
export function resolveMotion(tuning: IslandTuning): IslandMotion {
  return {
    morph: scaleSpring(tuning.morph, tuning.speed),
    settle: scaleSpring(tuning.settle, tuning.speed),
    crossfade: scaleSpring(tuning.crossfade, tuning.speed),
    timing: timingOf(tuning.pillHandover, tuning.swap),
    instant: tuning.instant,
  };
}

/**
 * The round trip: the tuning as the source lines `tuning.ts` authors it in, so an
 * experiment that felt right can be committed instead of transcribed.
 *
 * It prints the springs at the **rate they were watched** — the effective numbers,
 * not the stored ones — because `speed` is a lens for judging a 300ms hand-over
 * and not a preference: baking the rate into the springs and putting the lens back
 * to `1` is what leaves the island running what the eye approved.
 *
 * Compiled against by `tuning.test.ts`, which is the only guard there is on the
 * one function in the island that writes source code.
 */
export function sourceOf(tuning: IslandTuning): string {
  const at = (spring: IslandSpring): IslandSpring =>
    scaleSpring(spring, tuning.speed);

  const spring = (name: string, value: IslandSpring): string =>
    `const ${name.toUpperCase()}: IslandSpring = { type: "spring", ` +
    `stiffness: ${value.stiffness}, damping: ${value.damping}, mass: ${value.mass} };`;

  return [
    "// paste over the matching lines in tuning.ts (their JSDoc above stays).",
    ...(tuning.speed === 1
      ? []
      : [
          `// printed at speed ${tuning.speed} — what you watched; set speed back to 1 after pasting.`,
        ]),
    spring("morph", at(tuning.morph)),
    spring("settle", at(tuning.settle)),
    spring("crossfade", at(tuning.crossfade)),
    // The threshold and the windows are not rates, so they print as authored.
    `const SWAP_WINDOW: Readonly<Record<LayerSide, Fade>> = { ` +
      `in: { from: ${tuning.swap.in.from}, to: ${tuning.swap.in.to} }, ` +
      `out: { from: ${tuning.swap.out.from}, to: ${tuning.swap.out.to} } };`,
    `const PILL_HANDOVER = ${tuning.pillHandover};`,
  ].join("\n");
}

function number(
  rejected: string[],
  path: string,
  asked: unknown,
  ok: (value: number) => boolean,
  fallback: number,
): number {
  if (asked === undefined) return fallback;
  if (typeof asked === "number" && Number.isFinite(asked) && ok(asked)) {
    return asked;
  }
  rejected.push(`${path} = ${show(asked)} — kept ${fallback}`);
  return fallback;
}

function instantOr(
  rejected: string[],
  fallback: boolean | null,
  asked: unknown,
): boolean | null {
  if (asked === undefined) return fallback;
  if (asked === null || typeof asked === "boolean") return asked;
  rejected.push(`instant = ${show(asked)} — kept ${String(fallback)}`);
  return fallback;
}

function show(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
