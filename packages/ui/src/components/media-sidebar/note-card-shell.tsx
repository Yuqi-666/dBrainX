// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The frame every note card wears: a timestamp that seeks, the card's identity
 * beside it, its actions at the far end, and — for a 文本笔记 — its body below.
 *
 * One frame for both card types because the difference between them is *what
 * the note is*, not how it is laid out: a title input and a node reference both
 * want the same row, and the two actions (更多, 取消引用) both belong to the same
 * trailing corner. The shell owns exactly three things and delegates the rest:
 *
 * - **The timestamp is the 定位 action** — the note's anchor is an icon button
 *   that seeks to it, its time carried in the tooltip. The card's measure belongs
 *   to the title, so the time is no longer printed in the row; the tooltip (and
 *   the button's `aria-label`) is where it is read.
 * - **The row is: identity first, verbs last.** The title (or the node reference)
 *   leads and takes the slack; 定位 and the card's own actions are one group at
 *   the far end, so 更多 cannot drift away from 定位 as the title grows.
 * - **The card is the focus target** (`data-note-id`). A progress-bar tick's
 *   click arrives as a list of ids (`TimestampFocusRequest`), and the sidebar
 *   keeps a ref map rather than a `querySelector`, because note ids come from
 *   stored JSON and a selector would have to escape whatever they contain.
 * - **The focus ring.** `focused` is the transient highlight a tick's click
 *   raises; the resting card is a hairline border that the hover darkens.
 * - **The focus boundary.** `onFocusLeave` fires only when focus leaves the card
 *   *entirely* — moving from the title into the body is not leaving — which is
 *   the edge an unpersisted draft needs to know about. React bubbles `blur`
 *   inner-to-outer, so by the time this runs the inner editor has already
 *   flushed its debounce.
 */
import type { ReactNode } from "react";
import { Crosshair } from "lucide-react";

import { Button } from "@workspace/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/ui/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import { formatTimeMs } from "../media-player/types";

export interface NoteCardShellProps {
  /** The note's id — the focus lookup key and the `data-*` hook. */
  noteId: string;
  /** The note's anchor on the timeline. */
  timeMs: number;
  /** No player yet — 定位 cannot seek, so it disables itself. */
  disabled: boolean;
  /** Ringed because a progress-bar tick just sent the user here. */
  focused: boolean;
  onLocate: () => void;
  /** Focus left the card altogether (`relatedTarget` is outside it, or gone). */
  onFocusLeave?: () => void;
  /** The card's identity, after the timestamp: a title input or a node reference. */
  header: ReactNode;
  /** The trailing actions (更多 / 取消引用). */
  actions?: ReactNode;
  /** The body — a 文本笔记's editor. A 节点引用 has none. */
  children?: ReactNode;
  cardRef?: (element: HTMLDivElement | null) => void;
  className?: string;
}

export function NoteCardShell({
  noteId,
  timeMs,
  disabled,
  focused,
  onLocate,
  onFocusLeave,
  header,
  actions,
  children,
  cardRef,
  className,
}: NoteCardShellProps) {
  const { t } = useI18n();

  const time = formatTimeMs(timeMs);

  return (
    <div
      ref={cardRef}
      data-slot="note-card"
      data-note-id={noteId}
      data-note-time={timeMs}
      onBlur={
        onFocusLeave
          ? (event) => {
              // `relatedTarget` is the element receiving focus, and it is `null`
              // when focus went to the body (a click on dead space) — both count
              // as leaving. A target still inside the card does not.
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next)) {
                return;
              }
              onFocusLeave();
            }
          : undefined
      }
      className={cn(
        "group/note flex w-full flex-col gap-1 rounded-lg border px-2 py-2 transition-colors",
        focused
          ? "border-ring ring-2 ring-ring/40"
          : "border-border/60 hover:border-border",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {/* The card's identity leads the row — a title (or a node reference) is
            what the note *is*, so it gets the left edge and all the slack. */}
        {header}

        {/* 定位 and the card's own actions are one group at the far end: they are
            both things done *to* the note, and keeping them together is what
            stops 更多 from drifting away as the title grows. */}
        <div className="ms-auto flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                onClick={onLocate}
                aria-label={translate("定位到 {value1}", { value1: time })}
              >
                <Crosshair aria-hidden />
              </Button>
            </TooltipTrigger>
            {/* The frame the note is anchored to, which used to be printed beside
                the icon: the card's measure belongs to the title now. */}
            <TooltipContent side="left">
              {t("定位到")} {time}
            </TooltipContent>
          </Tooltip>

          {actions}
        </div>
      </div>

      {children}
    </div>
  );
}
