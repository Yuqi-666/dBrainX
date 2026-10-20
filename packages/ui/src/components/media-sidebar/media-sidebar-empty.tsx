// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * What a sidebar tab shows when its list is empty: an icon, one line of what is
 * missing, and optionally a control that fills it in.
 *
 * A tab with no content is the *normal* state of both lists — a transcript needs
 * a transcription step that does not exist yet, and a node is usually opened to
 * watch it before it is annotated — so the empty state is not an edge case to be
 * quiet about. It is centred in the list area rather than pinned to the top.
 *
 * The action is the 字幕 tab's 「生成字幕」 button; the 笔记 tab passes none, because
 * its 加笔记 button is permanent toolbar chrome and a second, identical button
 * 24px below it would only ask the same question twice.
 *
 * (Deliberately not `empty-hint.tsx` from the node-content folder: that block is
 * `h-full` and owns a whole editor box, while these sit inside a scroll area.)
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@workspace/ui/lib/utils";

export interface MediaSidebarEmptyProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** A control for the empty list itself (today: 生成字幕). */
  action?: ReactNode;
  /** A line of feedback under the action (today: "转写能力尚未接入"). */
  hint?: ReactNode;
  className?: string;
}

export function MediaSidebarEmpty({
  icon: Icon,
  title,
  description,
  action,
  hint,
  className,
}: MediaSidebarEmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-4 py-10 text-center",
        className,
      )}
      data-slot="media-sidebar-empty"
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="text-sm text-foreground/80">{title}</p>
      {description ? (
        <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
      {hint ? (
        <p
          role="status"
          className="max-w-56 text-[11px] leading-relaxed text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
