// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, useState } from "react";

import { UNMEASURED_PILL } from "./forms";
import type { Box } from "./geometry";

export interface PillBox {
  readonly pill: Box;
  readonly measured: boolean;
}

/**
 * The collapsed pill's box, measured from the navigation row it contains — the
 * one form both of whose axes are authored by its own content.
 *
 * Three things make that measurement **intrinsic**, and the pill is unusable
 * without all of them:
 *
 * 1. The element is the row itself, not a wrapper: `w-fit` over shrink-proof
 *    items gives it a minimum content size, so no ancestor can squeeze it, while
 *    a wrapper is only ever as wide as the box it is put in.
 * 2. The row is never stretched to that box — no `h-full` — so the height it
 *    reports is the height it *needs* (44px touch targets on a coarse pointer,
 *    36px otherwise).
 * 3. The frame around it does not shrink (`flex-none` — see `stage.tsx`). That
 *    frame clips, so it has an automatic minimum size of zero, and the pill is
 *    measured from inside it: leave the shrink on and the measurement becomes
 *    self-referential, so one frame of spring undershoot narrows the pill
 *    permanently.
 *
 * Both axes then land in `resolveGeometry`, which takes the row's width as the
 * pill's width and its height as a floor under the authored one.
 *
 * The element arrives as state rather than through a ref read in an effect, so
 * the observer attaches whenever an idle layer actually mounts — including an
 * island that mounts already expanded, and again on the next collapse.
 *
 * `offsetWidth` / `borderBoxSize` are **layout** pixels; `getBoundingClientRect`
 * is not — it includes ancestor transforms, and this element lives inside the
 * frame the morph scales, which fed the scale back into the pill's own target.
 */
export function usePillBox(element: HTMLElement | null): PillBox {
  const [state, setState] = useState<PillBox>({
    pill: UNMEASURED_PILL,
    measured: false,
  });

  useEffect(() => {
    if (!element) return;

    const apply = (w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      const next = { w: round(w), h: round(h) };
      setState((current) =>
        current.measured &&
        current.pill.w === next.w &&
        current.pill.h === next.h
          ? current
          : { pill: next, measured: true },
      );
    };

    const measure = () => apply(element.offsetWidth, element.offsetHeight);

    // A first synchronous read keeps a morph starting on the very next
    // interaction from using the fallback width.
    measure();

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      if (box) apply(box.inlineSize, box.blockSize);
      else measure();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [element]);

  return state;
}

/** Sub-pixel churn in the row would retarget the spring for no reason. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
