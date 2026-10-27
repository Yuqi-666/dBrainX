// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The task readout: the hover tooltip over a task bar or a task row.
 *
 * VTable-Gantt has no built-in tooltip (its only one is for mark-line creation),
 * and a bar is a canvas shape rather than a React node, so there is nothing to
 * hand Radix as a trigger. The readout therefore renders an invisible,
 * `position: fixed` `<span>` at the pointer the library reported and lets Radix
 * anchor to it — the same technique the calendar uses for its events and the
 * table for its canvas-anchored menus.
 *
 * The whole tooltip goes through {@link BodyLayer}: a `position: fixed` anchor
 * inside a transformed ancestor (the node editor's centred dialog) would be
 * measured from that ancestor, not the viewport, and the readout would sit
 * somewhere else entirely (`shared/body-layer.tsx`).
 */
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/ui/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import { BodyLayer } from "../../../shared/body-layer";
import type { GanttTaskReadout } from "../core/schema";
import type { GanttPoint } from "./gantt-surface";

/**
 * The invisible box Radix measures instead of a real trigger.
 *
 * It has to be a **plain `<span>`**, not a wrapper component: `asChild` hands the
 * anchor ref to its immediate child, and a component that does not forward that
 * ref leaves Floating UI measuring `null` — the panel then renders at the
 * viewport origin.
 */
function anchorStyle(point: GanttPoint) {
  return {
    position: "fixed",
    left: point.x,
    top: point.y,
    width: 0,
    height: 0,
    pointerEvents: "none",
  } as const;
}

/** One `字段：值` line. */
function DetailRow({
  name,
  text,
  color,
}: {
  name: string;
  text: string;
  color?: string;
}) {
  useI18n();

  return (
    <span className="flex items-baseline gap-2 text-[11px]">
      <span className="shrink-0 text-background/60">{name}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        {color && (
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="min-w-0 truncate">{text}</span>
      </span>
    </span>
  );
}

/**
 * The hover readout: title, span and progress, then the `tooltipFields` values.
 *
 * It is a `Tooltip` because it must not take focus or stay open on click — it is
 * a readout, not a layer; a click opens the record.
 */
export function TaskHoverReadout({
  point,
  readout,
}: {
  point: GanttPoint;
  readout: GanttTaskReadout;
}) {
  const { t } = useI18n();

  return (
    <BodyLayer>
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger asChild>
            <span aria-hidden style={anchorStyle(point)} />
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="center"
            sideOffset={8}
            className="max-w-64 flex-col items-stretch gap-1 text-left"
          >
            <span className="flex flex-col gap-0.5">
              <span className={cn("text-xs font-medium")}>{readout.title}</span>
              {readout.dateText && (
                <span className="text-[11px] text-background/70 tabular-nums">
                  {readout.dateText}
                </span>
              )}
              {readout.groupCount !== undefined ? (
                <span className="text-[11px] text-background/70">
                  {readout.groupCount} {t("个任务")}{" "}
                </span>
              ) : (
                readout.progressText && (
                  <span className="text-[11px] text-background/70 tabular-nums">
                    {t("进度")} {readout.progressText}
                  </span>
                )
              )}
            </span>
            {readout.details.length > 0 && (
              <span className="flex flex-col gap-0.5 border-t border-background/15 pt-1">
                {readout.details.map((detail) => (
                  <DetailRow
                    key={detail.fieldId}
                    name={detail.name}
                    text={detail.text}
                    color={detail.color}
                  />
                ))}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </BodyLayer>
  );
}
