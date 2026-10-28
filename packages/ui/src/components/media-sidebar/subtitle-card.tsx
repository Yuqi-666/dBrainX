// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * One subtitle cue, as a card.
 *
 * The three states the design asks for, and the three class groups that make
 * them:
 *
 * - **Default — no styling.** A cue is a line of a transcript, not a button
 *   asking to be pressed, so a resting card is plain text on the panel.
 * - **Hover / focus / pressed.** `hover:bg-muted/60` is the pointer's answer,
 *   `active:bg-muted` is the press, and the focus ring is the keyboard's — the
 *   only states a cue that is *not* being spoken may wear.
 * - **The current frame — the theme colour.** The line being spoken prints in
 *   `--primary`, which is the one place this repository spends the accent on
 *   something the user did not click: the point of a transcript panel is to show
 *   where playback is, and a neutral wash is not readable at a glance from a
 *   narrow sidebar.
 *
 * Clicking seeks to the cue's `timeMs` — "set the player to this frame", the
 * same gesture a note card's 定位 performs. A cue with no `endMs` prints its
 * start alone rather than inventing an end (`– 0:15` would read as a span the
 * data does not have).
 */
import type { TimestampSubtitleData } from "@workspace/interfaces";

import { cn } from "@workspace/ui/lib/utils";

import { formatTimeMs } from "../media-player/types";

export interface SubtitleCardProps {
  cue: TimestampSubtitleData;
  /** The playhead is inside this cue's span (see `activeCueIndex`). */
  active: boolean;
  /** No player yet — the card cannot seek, so it disables itself. */
  disabled: boolean;
  onSeek: () => void;
  cardRef?: (element: HTMLButtonElement | null) => void;
  className?: string;
}

export function SubtitleCard({
  cue,
  active,
  disabled,
  onSeek,
  cardRef,
  className,
}: SubtitleCardProps) {
  const { t } = useI18n();

  const start = formatTimeMs(cue.timeMs);
  const end = cue.endMs === undefined ? null : formatTimeMs(cue.endMs);
  const empty = cue.content.length === 0;

  return (
    <button
      ref={cardRef}
      type="button"
      disabled={disabled}
      onClick={onSeek}
      // `aria-current` is the machine-readable half of the theme colour: a
      // screen reader has to hear "this is where playback is" too.
      aria-current={active ? "true" : undefined}
      aria-label={translate("跳到 {value1}：{value2}", {
        value1: start,
        value2: empty ? t("空白字幕") : cue.content,
      })}
      data-slot="subtitle-card"
      data-active={active ? "" : undefined}
      className={cn(
        "group/cue w-full rounded-md px-2 py-1.5 text-start transition-colors outline-none",
        "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
        "active:bg-muted",
        active && "bg-muted/40",
        disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
        className,
      )}
    >
      <span className="flex items-baseline gap-1.5 text-[10px] leading-4 tabular-nums text-muted-foreground/70">
        {start}
        {end ? <span className="text-muted-foreground/50">– {end}</span> : null}
      </span>
      <span
        className={cn(
          "block text-sm leading-relaxed break-words whitespace-pre-wrap",
          empty && "text-muted-foreground italic",
          active && "font-medium text-primary",
        )}
      >
        {empty ? t("（空白字幕）") : cue.content}
      </span>
    </button>
  );
}
