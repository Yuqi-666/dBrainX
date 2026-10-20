// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The video.js v10 controller bridge, pinned. Run with:
 *
 * ```sh
 * pnpm --filter=@workspace/ui test
 * ```
 *
 * `media-controller.ts` is the seam between the frozen `MediaController`
 * contract (integer milliseconds, `seek` clamped to the duration) and the v10
 * player store (float seconds, a live `currentTime` getter, `subscribe` with no
 * argument). Both halves of that mismatch are invisible in a screenshot and
 * both are silent when wrong: a factor-of-1000 slip anchors every note to
 * `0:00`, and a leaked store subscription keeps an animation-frame loop alive
 * for the life of the player.
 *
 * The store is a hand-written fake rather than a real player: the real one
 * needs a `<video>`, and `node --test` has no DOM. It is deliberately **not**
 * declared as `VideoJsPlayerStore` (whose state is `readonly`, as the real
 * store's getters are) so the test can move the playhead; a mutable object is
 * assignable to the readonly contract, which is what the last test asserts
 * implicitly by passing it to the controller.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createVideoJsMediaController } from "./media-controller.ts";

interface FakeStore {
  currentTime: number;
  duration: number;
  paused: boolean;
  rejectPlay: boolean;
  /** Number of live store subscriptions (the leak canary). */
  subscriptions: number;
  /** Every value passed to `seek`, in the store's own seconds. */
  seeks: number[];
  plays: number;
  pauses: number;
  play(): unknown;
  pause(): void;
  seek(time: number): unknown;
  subscribe(callback: () => void): () => void;
  /** Fire every current listener, as a `timeupdate` would. */
  emit(): void;
}

type FakeStoreSeed = Partial<
  Pick<FakeStore, "currentTime" | "duration" | "paused" | "rejectPlay">
>;

function createFakeStore(seed: FakeStoreSeed = {}): FakeStore {
  const listeners = new Set<() => void>();

  const store: FakeStore = {
    currentTime: 0,
    duration: 120,
    paused: true,
    rejectPlay: false,
    subscriptions: 0,
    seeks: [],
    plays: 0,
    pauses: 0,
    ...seed,
    play: () => {
      store.plays += 1;
      return store.rejectPlay
        ? Promise.reject(new Error("autoplay blocked"))
        : Promise.resolve();
    },
    pause: () => {
      store.pauses += 1;
    },
    seek: (time: number) => {
      store.seeks.push(time);
      store.currentTime = time;
      return Promise.resolve(time);
    },
    subscribe: (callback: () => void) => {
      listeners.add(callback);
      store.subscriptions += 1;
      return () => {
        listeners.delete(callback);
        store.subscriptions -= 1;
      };
    },
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
  };

  return store;
}

/**
 * `node --test` has no animation-frame API. The controller only reaches for it
 * while playing with a listener attached, so the stub is load-bearing in exactly
 * the tests that subscribe.
 */
function withFrames(run: () => void): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const hadRequest = typeof globals.requestAnimationFrame === "function";
  if (!hadRequest) {
    globals.requestAnimationFrame = () => 1;
    globals.cancelAnimationFrame = () => {};
  }
  try {
    run();
  } finally {
    if (!hadRequest) {
      delete globals.requestAnimationFrame;
      delete globals.cancelAnimationFrame;
    }
  }
}

test("reads the store's seconds as integer milliseconds", () => {
  const store = createFakeStore({ currentTime: 12.3456, duration: 120.5 });
  const controller = createVideoJsMediaController(store);

  assert.equal(controller.getCurrentTimeMs(), 12_346);
  assert.equal(controller.getDurationMs(), 120_500);

  // A store that has not loaded metadata reports NaN; a note anchored to NaN is
  // unreadable, so the contract says 0 (`media-player/types.ts:29`).
  store.currentTime = Number.NaN;
  store.duration = Number.NaN;
  assert.equal(controller.getCurrentTimeMs(), 0);
  assert.equal(controller.getDurationMs(), 0);

  // A live stream's duration is Infinity.
  store.duration = Number.POSITIVE_INFINITY;
  assert.equal(controller.getDurationMs(), 0);
});

test("reports paused state and dispatches play / pause", () => {
  const store = createFakeStore();
  const controller = createVideoJsMediaController(store);

  assert.equal(controller.isPaused(), true);

  store.paused = false;
  assert.equal(controller.isPaused(), false);

  controller.pause();
  assert.equal(store.pauses, 1);

  controller.play();
  assert.equal(store.plays, 1);
});

test("a rejected play() is swallowed, not left unhandled", async () => {
  const store = createFakeStore({ rejectPlay: true });
  const controller = createVideoJsMediaController(store);

  // Must not throw synchronously, and must not surface an unhandled rejection.
  assert.doesNotThrow(() => controller.play());
  await Promise.resolve();
  assert.equal(store.plays, 1);
});

test("seek converts to seconds and clamps to the known duration", () => {
  const store = createFakeStore({ duration: 120 });
  const controller = createVideoJsMediaController(store);

  controller.seek(90_000);
  assert.deepEqual(store.seeks, [90]);

  controller.seek(-5_000);
  assert.equal(store.seeks.at(-1), 0);

  // Past the end pins to the end, not past it.
  controller.seek(500_000);
  assert.equal(store.seeks.at(-1), 120);
});

test("seek before metadata is known does not collapse to 0", () => {
  // duration 0 = "metadata not here yet". Clamping to [0, 0] would drop the
  // gesture entirely, so the value passes through and the element decides.
  const store = createFakeStore({ duration: 0 });
  const controller = createVideoJsMediaController(store);

  controller.seek(30_000);
  assert.deepEqual(store.seeks, [30]);
});

test("subscribe attaches the store listener lazily and detaches with the last one", () => {
  withFrames(() => {
    const store = createFakeStore();
    const controller = createVideoJsMediaController(store);

    // Nobody listening: no store subscription and no animation-frame loop. A
    // video node that only reads and seeks (today's `TimestampNotes`) costs
    // nothing.
    assert.equal(store.subscriptions, 0);

    const seen: number[] = [];
    const releaseFirst = controller.subscribe((timeMs) => seen.push(timeMs));
    assert.equal(store.subscriptions, 1);

    const releaseSecond = controller.subscribe((timeMs) => seen.push(timeMs));
    assert.equal(store.subscriptions, 1, "one store listener serves them all");

    // A transport change reports the position to every subscriber.
    store.currentTime = 3;
    store.emit();
    assert.deepEqual(seen, [3_000, 3_000]);

    releaseFirst();
    assert.equal(store.subscriptions, 1, "the second subscriber is still live");
    releaseSecond();
    assert.equal(store.subscriptions, 0, "the last one releases the store");
  });
});

test("seek notifies at once instead of waiting for the store to echo", () => {
  withFrames(() => {
    const store = createFakeStore();
    const controller = createVideoJsMediaController(store);
    const seen: number[] = [];
    controller.subscribe((timeMs) => seen.push(timeMs));

    controller.seek(45_000);
    assert.deepEqual(seen, [45_000], "the readout must not lag the gesture");
  });
});
