// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The event readout: the hover tooltip.
 *
 * It hangs off a FullCalendar limitation: an event is **not a React node** (the
 * library renders its own DOM), so there is nothing to hand Radix as a trigger.
 * The readout therefore renders an invisible, `position: fixed` `<span>` at the
 * event's viewport rect and lets Radix anchor to it — the same technique the
 * table uses for its canvas-anchored panels. The rect is the one FullCalendar
 * hands `eventMouseEnter` (`arg.el`).
 *
 * Both ends of that pair travel through {@link BodyLayer}: Radix portals the
 * *content* to `document.body` itself, but the anchor would stay inside a
 * transformed ancestor — the node editor's centred dialog — whose transform makes
 * it the containing block for `position: fixed`, so the readout would be measured
 * from the dialog instead of the viewport (`shared/body-layer.tsx`).
 *
 * A click on an event is not a readout any more: it opens the shared record
 * editor, so the old click popover went with the 交互 panel.
 */
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/ui/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import { BodyLayer } from "../../../shared/body-layer";
import type { CalendarEventReadout } from "../core/schema";

/** Viewport rect of the event the readout points at. */
export interface EventAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The invisible box Radix measures instead of a real trigger.
 *
 * It has to be a **plain `<span>`**, not a wrapper component: `asChild` hands the
 * anchor ref to its immediate child, and a component that does not forward that
 * ref leaves Floating UI measuring `null` — the panel then renders at the
 * viewport origin (measured: a popover whose button sat at `y = -157`).
 *
 * The return type is inferred (and the literals are `as const`) rather than
 * annotated `CSSProperties`: this package and its consumers resolve *different*
 * copies of `csstype`, so naming the type here makes the value unassignable to
 * the JSX `style` prop in the web app's compilation.
 */
function anchorStyle(rect: EventAnchor) {
  return {
    position: "fixed",
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    pointerEvents: "none",
  } as const;
}

/** One `字段：值` line. */
function DetailRow({
  name,
  text,
  color,
  className,
}: {
  name: string;
  text: string;
  color?: string;
  className?: string;
}) {
  return (
    <span className="flex items-baseline gap-2 text-[11px]">
      <span className={cn("shrink-0", className)}>{name}</span>
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
 * The hover readout: title + date, then the `config.tooltipFields` values.
 *
 * It is a `Tooltip` because it must not take focus or stay open on click — it is
 * a readout, not a layer.
 */
export function EventHoverReadout({
  rect,
  readout,
}: {
  rect: EventAnchor;
  readout: CalendarEventReadout;
}) {
  return (
    <BodyLayer>
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger asChild>
            <span aria-hidden style={anchorStyle(rect)} />
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="center"
            sideOffset={6}
            className="max-w-64 flex-col items-stretch gap-1 text-left"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">{readout.title}</span>
              {readout.dateText && (
                <span className="text-[11px] text-background/70 tabular-nums">
                  {readout.dateText}
                </span>
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
                    className="text-background/60"
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
