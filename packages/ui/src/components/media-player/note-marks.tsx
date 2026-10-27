// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { translate } from "@workspace/ui/lib/i18n/runtime";

/**
 * The timestamp ticks, drawn **inside the player's own seek bar**.
 *
 * M6 drew the mark layer in a sibling React bar under the media element,
 * because the player was a bare `<video>` with no slot inside its native
 * control bar. Both players are video.js v10 now and compose their controls
 * from parts, so the ticks live in the slider's track: the layer is a child of
 * `TimeSlider.Track` and shares its coordinate system, which is why a tick at
 * `timeMs / duration` lands on the same pixel as the fill without measuring
 * anything.
 *
 * Four details are load-bearing:
 *
 * 1. **The slider must not also handle the click.** The track's pointer handler
 *    is a React prop on the slider root, so stopping propagation on the tick's
 *    own `pointerdown` keeps the seek exact (`timeMs`) rather than "wherever the
 *    pointer happened to land inside a 5px-wide button".
 * 2. **Notes at one millisecond share a tick.** `groupNotesByTime` collapses
 *    them, so the second capture is not hidden under the first; the tooltip
 *    lists them all and the activation reports them all.
 * 3. **The tooltip stays inside the player.** The video container clips
 *    (`overflow: clip`), so `tooltipAlignment` hangs it inward near the edges.
 * 4. **No store, no player context.** The layer is handed a
 *    {@link MediaController} and the duration, so it is plain React: it works
 *    for the audio preset and the video preset alike, and it re-renders only
 *    when the duration changes — never once per animation frame.
 */
import * as React from "react";
import type { TimestampNoteData } from "@workspace/interfaces";

import { cn } from "@workspace/ui/lib/utils";

import {
  formatTimeMs,
  groupNotesByTime,
  noteTitle,
  positionPercent,
  tooltipAlignment,
} from "./types";
import type { MediaController, TimestampNoteActivation } from "./types";

interface NoteMarksProps {
  /** The persisted notes; the ticks are derived from them. */
  notes: readonly TimestampNoteData[];
  /** `null` before the player reports one — no tick can seek without it. */
  controller: MediaController | null;
  /**
   * The media duration in **seconds** (`0` until metadata arrives), read by the
   * owning player. Deliberately not subscribed here: the playhead is the skin's
   * own `.media-slider-fill`, so this layer never needs the current time.
   */
  durationSeconds: number;
  /** Fired after a tick's own seek, so the host can focus the matching card. */
  onActivateNote?: (activation: TimestampNoteActivation) => void;
  className?: string;
}

export function NoteMarks({
  notes,
  controller,
  durationSeconds,
  onActivateNote,
  className,
}: NoteMarksProps) {
  useI18n();

  const [openTimeMs, setOpenTimeMs] = React.useState<number | null>(null);

  const clusters = React.useMemo(() => groupNotesByTime(notes), [notes]);
  const duration = Number.isFinite(durationSeconds)
    ? Math.max(0, durationSeconds)
    : 0;
  // `duration === 0` means metadata has not arrived (or the stream is live), and
  // then `positionPercent` answers 0 for every note — which would stack every
  // tick on the bar's first pixel and read as a rendering bug. M6's marks layer
  // drew nothing until the duration was known; so does this one.
  const ready = duration > 0 && controller !== null;

  const close = (timeMs: number) => {
    setOpenTimeMs((current) => (current === timeMs ? null : current));
  };

  return (
    <div className={cn("vjs-note-marks", className)} data-slot="note-marks">
      {ready
        ? clusters.map((cluster) => {
            const percent = positionPercent(cluster.timeMs, duration);
            const open = openTimeMs === cluster.timeMs;
            const label = translate("跳到 {value1}", {
              value1: formatTimeMs(cluster.timeMs),
            });

            return (
              <button
                key={cluster.timeMs}
                type="button"
                data-note-time={cluster.timeMs}
                style={{ left: `${percent}%` }}
                className={cn("vjs-note-mark", open && "is-open")}
                aria-label={
                  cluster.notes.length > 1
                    ? translate("{value1}，{value2} 条笔记", {
                        value1: label,
                        value2: cluster.notes.length,
                      })
                    : label
                }
                title={label}
                // Keep the seek bar from treating this as a scrub gesture; the
                // tick's own click seeks to the note's exact millisecond.
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  controller?.seek(cluster.timeMs);
                  onActivateNote?.({
                    timeMs: cluster.timeMs,
                    noteIds: cluster.notes.map((note) => note.id),
                  });
                }}
                onMouseEnter={() => setOpenTimeMs(cluster.timeMs)}
                onMouseLeave={() => close(cluster.timeMs)}
                onFocus={() => setOpenTimeMs(cluster.timeMs)}
                onBlur={() => close(cluster.timeMs)}
              >
                <span className="vjs-note-mark-tick" aria-hidden />
                {open ? (
                  <span
                    role="tooltip"
                    className={cn(
                      "vjs-note-tooltip",
                      `is-${tooltipAlignment(percent)}`,
                    )}
                  >
                    <span className="vjs-note-tooltip-time">
                      {formatTimeMs(cluster.timeMs)}
                    </span>
                    {cluster.notes.map((note) => (
                      <span key={note.id} className="vjs-note-tooltip-text">
                        {/* Plain text: a tooltip inside the player's own DOM
                            must not pull the editor's schema in. */}
                        {notePlainText(note)}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })
        : null}
    </div>
  );
}

/** The note's title (or, failing that, its body's first line) as one line. */
function notePlainText(note: TimestampNoteData): string {
  return noteTitle(note).replace(/\s+/g, " ").trim();
}
