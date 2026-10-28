// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The playhead, for a list that wants to point at it.
 *
 * The sidebar is the one place besides the player where the current position is
 * *used* rather than merely displayed: the 字幕 stream highlights the cue being
 * spoken and (while it is auto-scrolling) keeps it in view, the 笔记 tab prints
 * the position its 加笔记 button will anchor to, and both want the number.
 *
 * The subscription is the reason this is a hook and not a prop. `controller`
 * reports once per animation frame while playing
 * (`media-controller.ts`: a rAF loop, so a progress readout follows the audio),
 * and re-rendering a thousand-row transcript 60 times a second to move a
 * highlight that changes a few times a minute is waste. Two guards keep it
 * cheap, and neither can make the value lie:
 *
 * 1. **Quantised to {@link PLAYHEAD_STEP_MS}.** The value handed to React is
 *    always a real multiple of the step, so nothing drifts — only the moment the
 *    list learns about it is up to a quarter second late, which is invisible for
 *    a `mm:ss` readout (that changes at most once a second) and fine for a cue
 *    highlight.
 * 2. **`setState` only when the answer changes.** The subscriber compares the
 *    whole derived value, so a paused player, a seek that lands in the same
 *    quarter second, or a re-render storm all cost nothing.
 *
 * A node opened mid-playback seeds from the current position rather than from
 * zero, so the line that is actually playing is the one that lights up.
 */
import * as React from "react";

import { formatTimeMs } from "../media-player/types";
import type { MediaController } from "../media-player/types";

/**
 * How far the playhead may move before React hears about it. See the module
 * docs: the step trades at most 250 ms of highlight latency for at most four
 * renders a second.
 */
export const PLAYHEAD_STEP_MS = 250;

export interface Playhead {
  /** The playhead in integer milliseconds, quantised to {@link PLAYHEAD_STEP_MS}. */
  timeMs: number;
  /** `timeMs` as `mm:ss` — the sidebar's only formatting of it. */
  label: string;
  /** The total length as `mm:ss`, or `""` while metadata has not loaded. */
  durationLabel: string;
}

/** The position before a player exists — the same value `getCurrentTimeMs` gives. */
const AT_ZERO: Playhead = { timeMs: 0, label: "0:00", durationLabel: "" };

/** Read the controller once, quantised, in the hook's own vocabulary. */
function readPlayhead(controller: MediaController): Playhead {
  const raw = controller.getCurrentTimeMs();
  const timeMs = Math.floor(raw / PLAYHEAD_STEP_MS) * PLAYHEAD_STEP_MS;
  const durationMs = controller.getDurationMs();
  return {
    timeMs,
    label: formatTimeMs(timeMs),
    // `0` is "not known yet" (and a live stream's `Infinity` reads `0:00`), so an
    // unknown length prints nothing rather than claiming the media is empty.
    durationLabel: durationMs > 0 ? formatTimeMs(durationMs) : "",
  };
}

/**
 * Subscribe to `controller` and return its playhead.
 *
 * `null` (no player yet, or a source that failed to load) is a supported state:
 * the hook reports the zero position and the lists render without a highlight.
 */
export function usePlayhead(controller: MediaController | null): Playhead {
  const [playhead, setPlayhead] = React.useState<Playhead>(AT_ZERO);

  React.useEffect(() => {
    if (!controller) {
      setPlayhead(AT_ZERO);
      return;
    }

    // One comparison for both the seed and every update: a player that reports
    // the same quarter second again (a pause, a re-render, a no-op seek) costs
    // no render at all.
    const apply = (next: Playhead) =>
      setPlayhead((current) =>
        current.timeMs === next.timeMs &&
        current.label === next.label &&
        current.durationLabel === next.durationLabel
          ? current
          : next,
      );

    apply(readPlayhead(controller));
    return controller.subscribe(() => apply(readPlayhead(controller)));
  }, [controller]);

  return playhead;
}
