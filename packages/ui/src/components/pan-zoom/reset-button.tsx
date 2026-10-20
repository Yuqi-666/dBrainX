// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * `PanZoomResetButton` — the **mouse** half of 恢复位置大小.
 *
 * The touch half is a single-finger double tap, recognised on the ink canvas by
 * `use-annotation-input.ts`. A mouse has no equivalent: a double click is two
 * ordinary clicks, and both of them are ink (a click is a dot — see
 * `use-annotation-input.ts`), so the desktop path cannot be a double click
 * without either delaying every dot by a double-tap window or deleting the first
 * one retroactively. A visible control is the honest answer: nothing is
 * ambiguous, and the button is discoverable in a way a gesture never is.
 *
 * It is deliberately part of the `pan-zoom` module rather than of a host: it
 * needs nothing but `{ transform, controller }` — the value `usePanZoom`
 * already returns — so any host (the image node) drops it in and gets the same
 * affordance:
 *
 * ```tsx
 * const panZoom = usePanZoom({ containerRef, getBounds });
 * // inside the `relative` container that the base lives in:
 * <PanZoomResetButton {...panZoom} />
 * ```
 *
 * {@link PanZoomResetPill} is the same control without the `PanZoomController`
 * dependency, for a host whose fit is not a CSS transform — the pdf viewer, whose
 * zoom is a page-box multiplier: it decides for itself when the reader has left the
 * opening view and calls the pill with its own reset.
 *
 * ## Three things that are load-bearing
 *
 * 1. **`pointer-events-none` on the wrapper, `auto` on the button.** The control
 *    floats *over* the ink canvas, which is the host's only pointer target; a
 *    full-width strip that took pointers would carve a dead band out of the
 *    bottom of the photo where a pen could no longer draw. Only the pill itself
 *    is hittable.
 * 2. **`z-20`.** The ink canvas is `z-10` in the host's stacking context; a
 *    lower value would leave the button visible but unclickable, with every
 *    click landing on the canvas as a dot instead.
 * 3. **It renders `null` at fit.** The button is chrome for a *moved* base, and
 *    at identity it would be a no-op covering the bottom edge of the picture —
 *    visible exactly when there is nothing to restore. `transform` is the host's
 *    committed state, so mounting and unmounting is what makes it appear "after
 *    moving" and disappear again the moment 恢复 lands.
 */
import { Maximize } from "lucide-react";

import { Button } from "@workspace/ui/components/ui/button";
import { cn } from "@workspace/ui/lib/utils";

import { isIdentityTransform } from "./transform";
import type { PanZoom } from "./types";

export interface PanZoomResetButtonProps extends PanZoom {
  /** Visible text, and the accessible name. */
  label?: string;
  /** Position overrides for a host whose bottom edge is not the right place. */
  className?: string;
}

/**
 * The pill itself — presentational, and shared with hosts that do **not** own a
 * {@link ViewportTransform}.
 *
 * The pdf viewer is that host: its "fit" is a page-box multiplier rather than a
 * CSS transform, so it has no `PanZoomController` to hand over, but 恢复位置大小
 * looks and behaves exactly like this on both. Rendering the button is therefore
 * split from deciding *when* it is there — the transform host asks
 * `isIdentityTransform`, the pdf asks whether the reader has left the opening
 * view, and neither duplicates the chrome (or its two load-bearing details, the
 * pointer-events sandwich and `z-20`).
 */
export interface PanZoomResetPillProps {
  /** Visible text, and the accessible name. */
  label?: string;
  /** Position overrides for a host whose bottom edge is not the right place. */
  className?: string;
  onClick: () => void;
}

export function PanZoomResetPill({
  label = translate("恢复位置大小"),
  className,
  onClick,
}: PanZoomResetPillProps) {
  useI18n();

  return (
    <div
      data-pan-zoom-reset
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center",
        className,
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={label}
        onClick={onClick}
        // The floating chrome the annotation toolbar already uses, so the two
        // controls read as one family: popover surface, hairline border, blur.
        className="pointer-events-auto border-border/60 bg-popover/95 text-popover-foreground shadow-md ring-1 ring-foreground/5 backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
      >
        <Maximize aria-hidden />
        {label}
      </Button>
    </div>
  );
}

export function PanZoomResetButton({
  transform,
  controller,
  label = translate("恢复位置大小"),
  className,
}: PanZoomResetButtonProps) {
  useI18n();

  // The one render-time decision: at fit there is nothing to restore, so there
  // is no button. `isIdentityTransform` is the same predicate the clamp and the
  // gestures use, so "the button is gone" and "the view is at fit" cannot
  // disagree.
  if (isIdentityTransform(transform)) return null;

  return (
    <PanZoomResetPill
      label={label}
      className={className}
      onClick={() => controller.reset()}
    />
  );
}
