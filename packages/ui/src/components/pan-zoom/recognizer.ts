// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The **decisions** inside the pointer state machine, pulled out of React so they
 * can be asserted (`recognizer.test.ts`) and reused by a future host.
 *
 * `use-annotation-input.ts` keeps the plumbing (which pointer is down, is the pen
 * active, when to request a frame); everything here is a question with a settled
 * answer — "is this sequence a tap or a drag?", "how many fingers landed?",
 * "is this the second tap of a double tap?" — and each one is a place a gesture
 * layer typically gets subtly wrong (a 9px wobble cancelling an undo, a long
 * press counting as a tap, two taps in opposite corners counting as one).
 *
 * No React and no DOM: the hook feeds plain numbers in and acts on the enum out.
 * A pdf host that grows its own gesture surface (because it also scrolls) can
 * import these instead of re-deriving the thresholds.
 */
export interface GesturePoint {
  x: number;
  y: number;
}

/** A finger may wander this far and still count as a tap, in CSS px. */
export const TAP_SLOP = 10;

/** …and take this long. Longer is a press, and a press is not a tap. */
export const TAP_MAX_MS = 400;

/** 单指双击: the second tap must start within this window of the first (ms). */
export const DOUBLE_TAP_MS = 320;

/** …and within this distance of it, so taps in two different corners are not one. */
export const DOUBLE_TAP_SLOP = 40;

/** The mean of the given points; the origin when there are none. */
export function centroidOf(points: Iterable<GesturePoint>): GesturePoint {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
    count += 1;
  }
  if (count === 0) return { x: 0, y: 0 };
  return { x: x / count, y: y / count };
}

/**
 * The fingers' spread — the mean distance to their centroid, or `0` for fewer
 * than two.
 *
 * Deliberately not "the distance between the first two": with that definition a
 * third finger landing, or one of three lifting, changes which pair is measured
 * and the zoom jumps. A centroid-based spread is continuous under both, which is
 * what lets `PanZoomController.pinch` keep a single anchor for the whole gesture.
 */
export function spreadOf(
  points: Iterable<GesturePoint>,
  centre: GesturePoint,
): number {
  let sum = 0;
  let count = 0;
  for (const point of points) {
    sum += Math.hypot(point.x - centre.x, point.y - centre.y);
    count += 1;
  }
  if (count < 2) return 0;
  return sum / count;
}

/** Everything the end of a touch sequence has to be judged on. */
export interface TapState {
  /**
   * The sequence ended in a way that can be a tap — i.e. a `pointerup`, never a
   * `pointercancel` or a `lostpointercapture` (a sequence the browser took away
   * is not something the user finished).
   */
  tap: boolean;
  /** At least one of the pointers was a touch. Mouse drags never become undo. */
  touch: boolean;
  /** Some pointer moved further than {@link TAP_SLOP} from where it went down. */
  moved: boolean;
  /** Milliseconds from the first pointerdown to the last pointerup. */
  duration: number;
  /** The most pointers that were down at once — the tap's finger count. */
  peak: number;
}

/**
 * What a finished touch sequence was, if it was a tap at all.
 *
 * `"tap"` is a one-finger tap, and it is the caller's job to decide whether it is
 * the second half of a double tap ({@link isDoubleTap}) or nothing. Two and three
 * fingers are already unambiguous.
 */
export type TapOutcome = "undo" | "redo" | "tap";

export function classifyTapEnd(state: TapState): TapOutcome | null {
  if (!state.tap || !state.touch || state.moved) return null;
  if (state.duration > TAP_MAX_MS) return null;
  if (state.peak >= 3) return "redo";
  if (state.peak === 2) return "undo";
  return "tap";
}

/**
 * Is `current` the second tap of a double tap started by `previous`?
 *
 * Measured in time *and* space: two taps a second apart are two taps, and so are
 * two taps in opposite corners of a large photo — the second is a normal tap that
 * happens to start a fresh window, not a reset.
 */
export function isDoubleTap(
  previous: { time: number; x: number; y: number } | null,
  current: { time: number; x: number; y: number },
  maxDelay: number = DOUBLE_TAP_MS,
  maxDistance: number = DOUBLE_TAP_SLOP,
): boolean {
  if (!previous) return false;
  const delay = current.time - previous.time;
  // A negative delay means the clock went backwards (a synthetic event, a
  // `timeStamp` from another document): treat it as "not a double tap" rather
  // than letting it match forever.
  if (delay < 0 || delay > maxDelay) return false;
  return (
    Math.hypot(current.x - previous.x, current.y - previous.y) <= maxDistance
  );
}
