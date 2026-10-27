// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The video.js v10 side of the {@link MediaController} contract
 * (`media-player/types.ts`).
 *
 * M6 bound a controller to an `HTMLMediaElement` (`createMediaController`).
 * Video.js v10 has no element to bind: the store *is* the player, and the
 * `<video>` / `<audio>` underneath it is created by the media component and can
 * even be replaced when the source changes. So the note layer keeps its
 * vocabulary and this file re-implements the seven methods over the store.
 *
 * Two deltas against the element version, both because the store is not an
 * element:
 *
 * 1. **Units.** `currentTime` / `duration` are float **seconds** there, as they
 *    are on a media element; every boundary here converts to the integer
 *    millisecond the contract stores.
 * 2. **Subscription cost.** The element version attaches its transport
 *    listeners once and never detaches them. The store's subscription is
 *    attached lazily — only while at least one listener is subscribed — so a
 *    player nobody subscribes to pays for no animation-frame loop and no store
 *    listener.
 */
import type { MediaController } from "./types";

/**
 * The slice of a v10 player store this controller needs, declared structurally
 * so it does not drag `@videojs/react`'s store types into the media layer.
 * Both `VideoPlayerStore` and `AudioPlayerStore` from `@videojs/react` satisfy
 * it — they are the same `PlayerStore<Features>` shape over different feature
 * sets, and playback + time + volume are in both.
 */
export interface VideoJsPlayerStore {
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  play(): unknown;
  pause(): void;
  seek(time: number): unknown;
  subscribe(callback: () => void): () => void;
}

/** Round to an integer millisecond and squeeze `NaN` / `Infinity` to `0`. */
function toMs(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
}

/**
 * Bind a {@link MediaController} to a video.js v10 player store.
 *
 * `subscribe` reports on every store change (which is where v10 publishes
 * `timeupdate`, `play`, `pause`, `seeking`, `durationchange`, …) and, while
 * playing, once per animation frame — the same promise `createMediaController`
 * makes, so a progress readout follows the media instead of stepping four times
 * a second.
 */
export function createVideoJsMediaController(
  store: VideoJsPlayerStore,
): MediaController {
  const listeners = new Set<(timeMs: number) => void>();
  let frame: number | null = null;
  let releaseStore: (() => void) | null = null;

  const currentTimeMs = (): number => toMs(store.currentTime);

  const notify = (): void => {
    const ms = currentTimeMs();
    for (const listener of listeners) listener(ms);
  };

  const stopFrames = (): void => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const tick = (): void => {
    frame = null;
    if (store.paused || listeners.size === 0) return;
    notify();
    frame = requestAnimationFrame(tick);
  };

  const ensureFrames = (): void => {
    if (store.paused || listeners.size === 0 || frame !== null) return;
    frame = requestAnimationFrame(tick);
  };

  const onStoreChange = (): void => {
    notify();
    ensureFrames();
  };

  // Attached on the first listener and released with the last one, so a store
  // that outlives its subscribers (it is owned by the player provider) is not
  // left with a listener that resurrects an animation-frame loop.
  const attach = (): void => {
    releaseStore ??= store.subscribe(onStoreChange);
  };

  const detach = (): void => {
    releaseStore?.();
    releaseStore = null;
    stopFrames();
  };

  return {
    getCurrentTimeMs: currentTimeMs,
    getDurationMs: () => toMs(store.duration),
    isPaused: () => store.paused,
    play: () => {
      const started = store.play();
      // A rejected `play()` is the autoplay policy or a source that is not
      // ready; the transport button is a user gesture in practice, and an
      // unhandled rejection is not worth the fidelity (`types.ts:44`).
      if (started instanceof Promise) void started.catch(() => {});
      ensureFrames();
    },
    pause: () => {
      store.pause();
      stopFrames();
    },
    seek: (timeMs: number) => {
      const durationMs = toMs(store.duration);
      const target = Math.min(
        Math.max(timeMs, 0),
        durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY,
      );
      if (!Number.isFinite(target)) return;
      const seeking = store.seek(target / 1000);
      if (seeking instanceof Promise) void seeking.catch(() => {});
      // Report the new position at once rather than waiting for the store to
      // echo it, so a clicked note's card is in step with the readout.
      notify();
    },
    subscribe: (listener: (timeMs: number) => void) => {
      listeners.add(listener);
      attach();
      ensureFrames();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) detach();
      };
    },
  };
}
