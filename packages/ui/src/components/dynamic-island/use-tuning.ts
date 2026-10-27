// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { IslandMotion, IslandTuning, TuningPatch } from "./tuning";
import {
  applyPatch,
  AUTHORED_TUNING,
  resolveMotion,
  ringOf,
  sourceOf,
} from "./tuning";

/**
 * The live half of `tuning.ts`: one tuning for the app, a subscription so React
 * re-renders when it moves, and — in development only — the console entry point
 * that moves it.
 *
 * The split is deliberate. `tuning.ts` is pure and import-free so it can be
 * executed by `node --test`; everything here touches a browser, so it cannot be,
 * and it is kept thin enough that there is nothing in it worth testing: a
 * mutable cell, a listener set, and the glue that makes `localStorage` and
 * `window.__island` reachable while the island is on screen.
 *
 * Nothing here can affect a production bundle: `DEV` is a compile-time
 * `process.env.NODE_ENV` read, so a production build drops the console, the
 * storage and the restore path together, and the island runs
 * `resolveMotion(AUTHORED_TUNING)` exactly as a tuned one would.
 */

/** A compile-time constant, so the dev-only branches fold away in a build. */
const DEV = process.env.NODE_ENV !== "production";

/**
 * Where a hand-tuned set survives a reload. It is *not* a public preference and
 * is never read in production — it exists so that watching a 300ms hand-over
 * does not mean re-typing numbers after every refresh.
 */
const STORAGE_KEY = "island:tuning";

const SPRINGS = ["morph", "settle", "crossfade"] as const;

let current: IslandTuning = AUTHORED_TUNING;
let restored = false;
const listeners = new Set<() => void>();

function getSnapshot(): IslandTuning {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: IslandTuning): IslandTuning {
  current = next;
  listeners.forEach((listener) => listener());
  return current;
}

/**
 * Move the island's feel. A partial patch — a field that cannot run is refused
 * with a reason and keeps its previous value (see `applyPatch`), so a bad number
 * never leaves the island in a state that cannot be looked at.
 *
 * Private to this module: the only ways in are the console (development) and the
 * authored numbers (production), which is the whole point of the split.
 */
function setTuning(patch: TuningPatch): IslandTuning {
  const { tuning, rejected } = applyPatch(current, patch);
  rejected.forEach((reason) => console.warn(`[island] ${reason}`));
  const next = commit(tuning);
  if (DEV) {
    // Only a *tuned* value is stored: `reset` forgets the key outright rather
    // than writing the authored numbers back into it.
    store(next);
    warnIfInsideTheRing(next);
  }
  return next;
}

/** Back to the authored numbers, and forget the stored ones. */
function resetTuning(): IslandTuning {
  if (DEV) forget();
  return commit(AUTHORED_TUNING);
}

/**
 * The springs and the timing table the island runs, for the current tuning.
 *
 * Resolved here rather than in the shell so the conversion happens once per
 * change instead of once per render — and so the component reads as what it is:
 * three springs' worth of decisions it does not make.
 */
export function useIslandMotion(): IslandMotion {
  const tuning = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    restore();
  }, []);
  return useMemo(() => resolveMotion(tuning), [tuning]);
}

/**
 * A threshold inside the landing spring's ring switches the pill off, on and off
 * again — the one tuning mistake that looks like a bug in the island rather than
 * in the number, so it is reported while the number is being typed.
 */
function warnIfInsideTheRing(tuning: IslandTuning): void {
  const ring = ringOf(tuning.settle);
  if (tuning.pillHandover > ring) return;
  console.warn(
    `[island] pillHandover ${tuning.pillHandover} is inside the settle spring's ` +
      `ring (${ring.toFixed(4)}): the pill will blink off and on as the box lands. ` +
      `Raise it — or damp \`settle\` — until it clears.`,
  );
}

function restore(): void {
  if (!DEV || restored) return;
  restored = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Hand-editable, so it is validated exactly like a console patch.
    if (raw) setTuning(JSON.parse(raw) as TuningPatch);
  } catch {
    // A stale or hand-broken entry is not a reason for the island to fail.
  }
}

function store(tuning: IslandTuning): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch {
    // Private mode, or a full quota: tuning still works, it just will not last.
  }
}

function forget(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See `store`.
  }
}

/** The console's own surface; also what `window.__island` is typed as. */
export interface IslandConsole {
  /** The command list. */
  help: () => void;
  /** The current numbers, as a table. */
  show: () => void;
  /** `__island.set({ speed: 0.25, pillHandover: 1.1 })` */
  set: (patch: TuningPatch) => IslandTuning;
  /** The rate, not a duration: `0.25` is quarter speed. */
  speed: (rate: number) => IslandTuning;
  /** `true` forces the reduced-motion cut, `false` forces the springs. */
  instant: (on: boolean | null) => IslandTuning;
  /** Back to the authored numbers. */
  reset: () => IslandTuning;
  /** Print the paste-ready lines for `tuning.ts`. */
  copy: () => void;
}

declare global {
  interface Window {
    /** Present in development only: the island's tuning console. */
    __island?: IslandConsole;
  }
}

const HELP = [
  "island tuning — the authored numbers live in packages/ui/src/components/dynamic-island/tuning.ts",
  "",
  "  __island.show()        the numbers now running, and the ring a collapse must clear",
  "  __island.set({...})    any subset — morph/settle/crossfade: { stiffness, damping, mass },",
  "                         speed, pillHandover, swap: { in: { from, to }, out: {...} }, instant",
  "  __island.speed(0.25)   quarter speed: ζ is preserved, so only the clock moves",
  "  __island.instant(true) the reduced-motion cut on demand; false forces the springs",
  "  __island.reset()       authored numbers again, and forget the stored ones",
  "  __island.copy()        print the paste-ready lines for tuning.ts",
].join("\n");

function install(): void {
  if (!DEV || typeof window === "undefined") return;

  window.__island = {
    help: () => console.info(HELP),
    show: () => console.table(rows(current)),
    set: (patch) => setTuning(patch),
    speed: (rate) => setTuning({ speed: rate }),
    instant: (on) => setTuning({ instant: on }),
    reset: () => resetTuning(),
    copy: () => {
      const snippet = sourceOf(current);
      console.log(snippet);
      navigator.clipboard?.writeText(snippet).catch(() => undefined);
    },
  };
}

/** One row per number, so the table reads as a list of knobs and not of objects. */
function rows(tuning: IslandTuning): Record<string, unknown>[] {
  return [
    {
      knob: "speed",
      value: tuning.speed,
      note: "rate — 0.25 is quarter speed",
    },
    {
      knob: "pillHandover",
      value: tuning.pillHandover,
      note: `must clear the ring ${ringOf(tuning.settle).toFixed(4)}`,
    },
    {
      knob: "instant",
      value: tuning.instant === null ? "null" : tuning.instant,
      note: "null follows the OS",
    },
    ...SPRINGS.flatMap((name) => {
      const spring = tuning[name];
      return [
        { knob: `${name}.stiffness`, value: spring.stiffness, note: "" },
        { knob: `${name}.damping`, value: spring.damping, note: "" },
        { knob: `${name}.mass`, value: spring.mass, note: "" },
      ];
    }),
    { knob: "swap.in", value: `${tuning.swap.in.from} → ${tuning.swap.in.to}` },
    {
      knob: "swap.out",
      value: `${tuning.swap.out.from} → ${tuning.swap.out.to}`,
    },
  ];
}

install();
