// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The 字幕 tab: the cue cards, and the one piece of behaviour they need — a
 * stream that follows playback until the user takes the scroll away from it.
 *
 * **Auto-scroll is the default, and it is not a toggle.** A transcript panel is
 * read *along with* the audio, so the line being spoken stays in view on its own.
 * The two mechanisms that make that live here:
 *
 * 1. **Following** — when the active cue changes, that card is scrolled into
 *    view with `block: "nearest"`. `nearest` is what keeps following
 *    unobtrusive: a card already on screen is not re-centred, so playback never
 *    fights a user who is reading a few lines ahead.
 * 2. **Detaching** — a scroll *gesture* (wheel, touch move, a keyboard scroll
 *    key, a drag of the scrollbar) means the user has taken over. Following stops
 *    immediately, and 「当前位置」 appears; clicking it scrolls back to the
 *    playhead **and re-attaches**, which is the whole way back to the default
 *    state. Nothing is remembered across a tab switch — a fresh mount follows.
 *
 * Detaching on the gesture rather than on the `scroll` event is deliberate:
 * `scrollIntoView` fires `scroll` too, so a scroll listener would make the first
 * programmatic follow switch following off by itself.
 *
 * Nothing produces cues yet — the backend has no transcription step — so the
 * empty state carries the 「生成字幕」 button. The data path is wired end to end
 * (`VideoContent.timestamps` → `nodes.timestamps` → `normalizeTimestamps`), so
 * when a transcription job exists it only has to append cues; the button calls
 * `onGenerateSubtitles` and, for now, says so out loud.
 */
import * as React from "react";
import { Captions, Locate, Sparkles } from "lucide-react";
import type { TimestampSubtitleData } from "@workspace/interfaces";

import { Button } from "@workspace/ui/components/ui/button";
import { cn } from "@workspace/ui/lib/utils";

import {
  activeCueIndex,
  playheadRowIndex,
  sortTimestamps,
} from "../media-player/types";
import type { MediaController } from "../media-player/types";

import { MediaSidebarEmpty } from "./media-sidebar-empty";
import { SubtitleCard } from "./subtitle-card";
import type { Playhead } from "./use-playhead";

/** How long the "no transcription yet" notice stays under the button. */
const HINT_MS = 4_000;

export interface SubtitleStreamProps {
  /** The cues of the node's timeline (the sidebar splits them out). */
  timestamps: readonly TimestampSubtitleData[];
  /** `null` until the player reports one; the cards disable themselves then. */
  controller: MediaController | null;
  /** The live playhead — what lights up and what 跟随 scrolls to. */
  playhead: Playhead;
  /** 「生成字幕」 — a host hook that will drive a transcription job. */
  onGenerateSubtitles?: () => void;
  className?: string;
}

export function SubtitleStream({
  timestamps,
  controller,
  playhead,
  onGenerateSubtitles,
  className,
}: SubtitleStreamProps) {
  const { t } = useI18n();

  const sorted = React.useMemo(() => sortTimestamps(timestamps), [timestamps]);

  // The cue being spoken, in `[0, sorted.length)` or `-1` for a gap.
  const active = React.useMemo(
    () => activeCueIndex(sorted, playhead.timeMs),
    [sorted, playhead.timeMs],
  );

  const [following, setFollowing] = React.useState(true);
  const [hint, setHint] = React.useState<string | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const cardRefs = React.useRef(new Map<number, HTMLButtonElement>());

  // Follow the playhead into the list. Re-runs only when the *active cue*
  // changes (a few times a minute), never when the playhead merely moves.
  React.useEffect(() => {
    if (!following || active < 0) return;
    cardRefs.current.get(active)?.scrollIntoView({ block: "nearest" });
  }, [following, active]);

  React.useEffect(() => {
    if (hint === null) return;
    const timer = window.setTimeout(() => setHint(null), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  // In a gap there is no active cue, so "locate" means the next line (or the
  // last one, once playback is past the end of the transcript).
  const locateIndex =
    active >= 0
      ? active
      : Math.min(playheadRowIndex(sorted, playhead.timeMs), sorted.length - 1);

  const locate = () => {
    cardRefs.current.get(locateIndex)?.scrollIntoView({ block: "nearest" });
    // Re-attaching is the point of the button: it is the way back to the
    // default state, not just a one-off jump.
    setFollowing(true);
  };

  const detach = () => setFollowing(false);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Only the scroll keys detach. `Tab` and `Enter` are navigation, and a
    // keypress inside a card's own control is not a scroll gesture.
    if (
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "PageUp" ||
      event.key === "PageDown" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      detach();
    }
  };

  const handleGenerate = () => {
    onGenerateSubtitles?.();
    setHint(t("转写能力尚未接入，暂时无法生成字幕。"));
  };

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", className)}>
      <div
        ref={viewportRef}
        // The gesture handlers are the detach trigger — see the module docs for
        // why the `scroll` event is deliberately not one of them.
        onWheel={detach}
        onTouchMove={detach}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          // A drag of the native scrollbar targets the viewport itself; a click
          // on a card targets the card and must not detach.
          if (event.target === viewportRef.current) detach();
        }}
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-1.5 pb-1"
        data-slot="subtitle-stream"
      >
        {sorted.length === 0 ? (
          <MediaSidebarEmpty
            icon={Captions}
            title={t("无字幕")}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerate}
              >
                <Sparkles aria-hidden />
                {t("生成字幕")}{" "}
              </Button>
            }
            hint={hint}
          />
        ) : null}

        {sorted.map((cue, index) => (
          <SubtitleCard
            // Two cues can share a span (and dirty data can repeat one); the
            // index keeps the key unique without inventing an id for stored JSON.
            key={`${cue.timeMs}:${cue.endMs ?? ""}:${index}`}
            cue={cue}
            active={index === active}
            disabled={!controller}
            onSeek={() => controller?.seek(cue.timeMs)}
            cardRef={(element) => {
              if (element) cardRefs.current.set(index, element);
              else cardRefs.current.delete(index);
            }}
          />
        ))}
      </div>

      {/* The way back to the playhead, and out of the detached state. Only shown
          once following is off: while it is on, the button would be a no-op that
          covers the cards. */}
      {!following && sorted.length > 0 ? (
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={locate}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow-md"
          aria-label={t("滚动到当前播放位置并恢复跟随")}
        >
          <Locate aria-hidden />
          {t("当前位置")}{" "}
        </Button>
      ) : null}
    </div>
  );
}
