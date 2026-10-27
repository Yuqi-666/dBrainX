// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useSyncExternalStore } from "react";

import type { Viewport } from "./geometry";

/**
 * Everything the island reads from the browser — as two **shared** stores.
 *
 * Both are module singletons behind `useSyncExternalStore`, which buys three
 * things a `useState` + `useEffect` hook cannot:
 *
 * 1. **One set of listeners for the whole tree.** The collapsed row draws one
 *    button per destination and every button needs the pointer kind; a hook with
 *    its own listeners would open two media queries per button.
 * 2. **A stable server snapshot.** `prefers-reduced-motion` and the viewport are
 *    not part of a server render, so a server pass uses the capable-device
 *    defaults and the first client pass reads the truth — with no hydration
 *    mismatch and no "read `window` during render" exception to the rule.
 * 3. **A cached snapshot.** `getSnapshot` is called on every render and must
 *    return the same object until something actually changes, or React loops.
 */

export interface IslandEnvironment {
  /** `prefers-reduced-motion: reduce` — the morph becomes a cut. */
  readonly reducedMotion: boolean;
  /** No hover, or a coarse pointer: bigger hit areas, no hover affordance. */
  readonly coarsePointer: boolean;
  /** `prefers-reduced-transparency: reduce` — opaque surface, no blur. */
  readonly reducedTransparency: boolean;
}

type Listener = () => void;

interface BrowserStore<T> {
  subscribe: (listener: Listener) => () => void;
  snapshot: () => T;
  serverSnapshot: () => T;
}

function createBrowserStore<T>(
  read: () => T,
  server: T,
  watch: (notify: Listener) => () => void,
  equals: (a: T, b: T) => boolean,
): BrowserStore<T> {
  let cached: T | null = null;
  let stop: (() => void) | null = null;
  const listeners = new Set<Listener>();

  /** Read the browser and store the result. Returns whether it changed. */
  const refresh = (): boolean => {
    const next = read();
    const current = cached ?? server;
    if (equals(current, next)) {
      // Keep the identity: a new object for the same values would make React's
      // post-subscribe consistency check re-render for nothing.
      cached = current;
      return false;
    }
    cached = next;
    return true;
  };

  return {
    subscribe(listener) {
      if (!stop) {
        stop = watch(() => {
          if (refresh()) listeners.forEach((known) => known());
        });
      }
      // Refresh before registering. React re-reads the snapshot right after
      // subscribing, so this is what a value that changed while nothing was
      // mounted has to be in — and notifying here would only be a second render.
      refresh();
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && stop) {
          stop();
          stop = null;
        }
      };
    },
    /**
     * Read lazily, on the first render that asks, rather than at module load: a
     * client render must not have to be corrected by an effect (a viewport of `0`
     * for one frame is a 1px-tall island). A server render asks for
     * `serverSnapshot` instead and never reaches this.
     */
    snapshot: () => (cached ??= read()),
    serverSnapshot: () => server,
  };
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const COARSE_POINTER = "(hover: none), (pointer: coarse)";
const REDUCED_TRANSPARENCY = "(prefers-reduced-transparency: reduce)";

const QUERIES = [REDUCED_MOTION, COARSE_POINTER, REDUCED_TRANSPARENCY] as const;

/**
 * The capable device. Used for a server render and for the first client paint;
 * subscribing replaces it with the truth, which can only ever *remove* motion or
 * transparency.
 */
const CAPABLE: IslandEnvironment = {
  reducedMotion: false,
  coarsePointer: false,
  reducedTransparency: false,
};

let lists: MediaQueryList[] | null = null;

function mediaQueries(): MediaQueryList[] {
  lists ??=
    typeof window.matchMedia === "function"
      ? QUERIES.map((query) => window.matchMedia(query))
      : [];
  return lists;
}

function readEnvironment(): IslandEnvironment {
  const [motion, pointer, transparency] = mediaQueries();
  return {
    reducedMotion: motion?.matches ?? false,
    coarsePointer: pointer?.matches ?? false,
    reducedTransparency: transparency?.matches ?? false,
  };
}

const environment = createBrowserStore(
  readEnvironment,
  CAPABLE,
  (notify) => {
    const queries = mediaQueries();
    queries.forEach((query) => query.addEventListener("change", notify));
    return () =>
      queries.forEach((query) => query.removeEventListener("change", notify));
  },
  (a, b) =>
    a.reducedMotion === b.reducedMotion &&
    a.coarsePointer === b.coarsePointer &&
    a.reducedTransparency === b.reducedTransparency,
);

const ZERO_VIEWPORT: Viewport = { w: 0, h: 0 };

const viewport = createBrowserStore(
  () => ({ w: window.innerWidth, h: window.innerHeight }),
  ZERO_VIEWPORT,
  (notify) => {
    window.addEventListener("resize", notify);
    return () => window.removeEventListener("resize", notify);
  },
  (a, b) => a.w === b.w && a.h === b.h,
);

export function useIslandEnvironment(): IslandEnvironment {
  return useSyncExternalStore(
    environment.subscribe,
    environment.snapshot,
    environment.serverSnapshot,
  );
}

/** The live viewport, in CSS pixels. */
export function useViewport(): Viewport {
  return useSyncExternalStore(
    viewport.subscribe,
    viewport.snapshot,
    viewport.serverSnapshot,
  );
}
