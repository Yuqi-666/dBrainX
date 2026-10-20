// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * `usePanZoom` — the single owner of a base surface's pan/zoom state.
 *
 * The contract with the host is three lines:
 *
 * ```tsx
 * const { transform, controller } = usePanZoom({ containerRef, getBounds });
 * // 1. paint the base with it
 * <img style={{ transform: transformToCss(transform), transformOrigin: "0 0" }} />
 * // 2. give the ink the rectangle it produces
 * <AnnotationLayer getBaseRect={() => applyTransform(fit, transform, origin)}
 *                  panZoom={controller} />
 * ```
 *
 * Both surfaces then read the *same* four numbers, which is what makes the
 * overlap structural (see `types.ts`).
 *
 * ## Why writes are coalesced to one commit per frame
 *
 * A pinch or a drag delivers samples at pointer rate (a 120Hz tablet reports two
 * per frame), and every commit re-renders the host *and* re-measures the ink
 * layer through `getBaseRect`'s identity. Committing each sample would do that
 * twice a frame for no visible gain, so {@link PanZoomController}'s mutators
 * write into a pending slot and schedule one `requestAnimationFrame`. Reads go
 * through {@link PanZoomController.current}, which returns the *pending* value —
 * a burst composes instead of every sample rebuilding from the last painted
 * frame (the pdf viewer documents the same trap at its `zoomTargetRef`).
 *
 * ## Desktop
 *
 * The wheel listener is bound natively (`{ passive: false }`) on the container
 * rather than through React's `onWheel`: React attaches wheel passively, so
 * `preventDefault` — which is what stops the page from scrolling while the photo
 * zooms — would be ignored. Plain wheel pans, ctrl/⌘-wheel zooms, which is the
 * convention the pdf viewer already uses for the same reason.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clampScale,
  clampTransform,
  IDENTITY_TRANSFORM,
  isIdentityTransform,
  MAX_VIEWPORT_SCALE,
  MIN_VIEWPORT_SCALE,
  panTransform,
  pinchTransform,
  zoomAbout,
} from "./transform";
import type {
  PanZoom,
  PanZoomController,
  PanZoomOptions,
  ViewportBounds,
  ViewportTransform,
} from "./types";

/** The origin used when the host cannot measure one — clamping is off, so it is never read meaningfully. */
const NO_ORIGIN = { x: 0, y: 0 };

/**
 * One wheel notch is 100px on Chrome/Firefox and a stream of small deltas on a
 * trackpad; `exp` keeps the two directions symmetric in feel and makes a burst
 * of small deltas accumulate into the same zoom a single notch gives.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.0025;

/**
 * Firefox reports wheel deltas in *lines*, and an un-normalised unit is the
 * difference between "zooms" and "does not move" (three lines is `3`). The pdf
 * viewer normalises identically; pdfjs itself uses 30px per line.
 */
const WHEEL_LINE_HEIGHT = 30;

function wheelDelta(event: WheelEvent, element: HTMLElement): number {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_HEIGHT;
  if (event.deltaMode === 2) return event.deltaY * element.clientHeight;
  return event.deltaY;
}

function sameTransform(a: ViewportTransform, b: ViewportTransform): boolean {
  return a.scale === b.scale && a.x === b.x && a.y === b.y;
}

export function usePanZoom({
  containerRef,
  getBounds,
  minScale = MIN_VIEWPORT_SCALE,
  maxScale = MAX_VIEWPORT_SCALE,
  enabled = true,
}: PanZoomOptions): PanZoom {
  const [transform, setTransform] =
    useState<ViewportTransform>(IDENTITY_TRANSFORM);

  /** The last committed value — what `transform` currently renders. */
  const committedRef = useRef<ViewportTransform>(IDENTITY_TRANSFORM);
  /** A value an animation frame still owes the host, if any. */
  const pendingRef = useRef<ViewportTransform | null>(null);
  const frameRef = useRef(0);

  /**
   * `getBounds` and the limits are read from *inside* callbacks that outlive the
   * render that created them (a rAF, a native wheel listener), so they come from
   * a ref rather than a dependency array.
   */
  const options = useRef({ getBounds, minScale, maxScale, enabled });
  options.current = { getBounds, minScale, maxScale, enabled };

  const current = useCallback(
    (): ViewportTransform => pendingRef.current ?? committedRef.current,
    [],
  );

  const flush = useCallback(() => {
    frameRef.current = 0;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (!next || sameTransform(next, committedRef.current)) return;
    committedRef.current = next;
    setTransform(next);
  }, []);

  /**
   * The one write path. `mutate` sees the *live* transform (pending included) so
   * a burst composes, and the result is clamped against a freshly measured
   * bounds — a window resize or a fit-mode change is therefore honoured by the
   * very next sample rather than by an effect that may run a frame later.
   */
  const apply = useCallback(
    (
      mutate: (
        transform: ViewportTransform,
        bounds: ViewportBounds | null,
      ) => ViewportTransform,
    ) => {
      const { getBounds: read, minScale: min, maxScale: max } = options.current;
      const bounds = read?.() ?? null;
      const wanted = mutate(current(), bounds);
      pendingRef.current = bounds
        ? clampTransform(wanted, bounds, min, max)
        : { ...wanted, scale: clampScale(wanted.scale, min, max) };
      if (!frameRef.current) frameRef.current = requestAnimationFrame(flush);
    },
    [current, flush],
  );

  const controller = useMemo<PanZoomController>(
    () => ({
      current,
      set: (next) => apply(() => next),
      panBy: (dx, dy) => apply((live) => panTransform(live, dx, dy)),
      zoomBy: (factor, clientX, clientY) =>
        apply((live, bounds) =>
          zoomAbout(
            live,
            clampScale(
              live.scale * factor,
              options.current.minScale,
              options.current.maxScale,
            ) / live.scale,
            { x: clientX, y: clientY },
            bounds?.origin ?? NO_ORIGIN,
          ),
        ),
      // Deliberately composed from `base` (the gesture's own snapshot) and not
      // from the live transform: a pinch that re-derived each frame from the
      // previous one would accumulate rounding into a slow drift.
      pinch: (base, factor, fromX, fromY, toX, toY) =>
        apply((_live, bounds) =>
          pinchTransform(
            base,
            clampScale(
              base.scale * factor,
              options.current.minScale,
              options.current.maxScale,
            ) / base.scale,
            { x: fromX, y: fromY },
            { x: toX, y: toY },
            bounds?.origin ?? NO_ORIGIN,
          ),
        ),
      reset: () => apply(() => IDENTITY_TRANSFORM),
      isTransformed: () => !isIdentityTransform(current()),
    }),
    [apply, current],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !enabled) return;

    const onWheel = (event: WheelEvent) => {
      // Without something measurable there is no base to move; leaving the event
      // alone lets a host that scrolls keep scrolling.
      if (!options.current.getBounds?.()) return;
      event.preventDefault();
      const delta = wheelDelta(event, element);

      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY);
        apply((live, bounds) =>
          zoomAbout(
            live,
            clampScale(
              live.scale * factor,
              options.current.minScale,
              options.current.maxScale,
            ) / live.scale,
            { x: event.clientX, y: event.clientY },
            bounds?.origin ?? NO_ORIGIN,
          ),
        );
        return;
      }
      // A trackpad reports both axes; a mouse reports the vertical one.
      apply((live) => panTransform(live, -event.deltaX, -delta));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [apply, containerRef, enabled]);

  /**
   * A container resize can invalidate the clamp (a wider box means more room to
   * pan, a narrower one means the current offset is out of bounds). Re-clamping
   * the *current* transform — rather than resetting it — keeps the reader where
   * they were and only corrects the part that no longer fits.
   */
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !enabled || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => apply((live) => live));
    observer.observe(element);
    return () => observer.disconnect();
  }, [apply, containerRef, enabled]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      pendingRef.current = null;
    },
    [],
  );

  return { transform, controller };
}
