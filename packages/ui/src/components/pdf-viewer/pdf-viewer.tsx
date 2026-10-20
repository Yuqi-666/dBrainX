// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The pdf viewer: a document surface plus its toolbar.
 *
 * Layout is **one scroller with two axes, two scroll behaviours and one or two
 * pages per slot** rather than eight separate views — the page strip is always
 * the same flex list, and 方向 / 滚动 / 单双页 only decide the axis, whether the
 * strip scroll-snaps, and how many pages a slot holds. That is what keeps
 * "垂直连续单页" and "水平翻页双页" from drifting apart as the viewer grows: page
 * navigation, virtualisation, search jumps and zoom anchoring are written once,
 * against the strip's geometry.
 *
 * A slot is the unit of everything: it is what the `IntersectionObserver`
 * watches, what scroll-snapping snaps to, what "the current page" is derived
 * from, and what a fit mode measures. 单页 makes it one page, 双页 makes it a
 * left/right pair — so the reader never has to know which mode is on.
 *
 * What is deliberate here:
 *
 * - **Pages render from the viewport, outwards.** An `IntersectionObserver`
 *   with a one-viewport margin decides which canvases exist; everything else
 *   keeps its measured size, so the strip never reflows while scrolling.
 * - **A zoom gesture paints twice, not once per notch.** The page box and the
 *   scroll anchor follow the multiplier immediately, but the *bitmap* lags: a
 *   wheel or pinch burst is painted by stretching the canvas from the scale it
 *   was last rasterised at, and pdfjs is re-run once the gesture settles.
 *   Rasterising per notch is what made zooming stutter — a heavy page takes tens
 *   of milliseconds, so every notch cancelled the render the notch before it had
 *   started and no notch ever finished. Only the pixels are stale while the
 *   gesture lasts (and the text layer is hidden, because its spans are still
 *   laid out for the old box).
 * - **What the lag may cost is bounded, not the lag itself.** A page is painted
 *   whole, so at a large multiplier its bitmap is quadratic in the zoom: `PDF_MAX_PIXELS`
 *   (through `pdfRasterDpr`) backs the density off until the surface fits a budget
 *   every browser allocates, and the ink layer is handed the same budget. A page
 *   is then a little soft at 6× instead of an allocation that fails — which is
 *   what an unpainted page used to look like (see `pdf-page.tsx` on `alpha`).
 * - **The page strip centres with auto margins, never `justify-content`.** A page
 *   can be wider than the viewport; unsafe centring would put half of that
 *   overflow before the scroll origin, where no scroll can reach it.
 * - **The current page is derived, not stored.** It is whichever page is
 *   nearest the viewport centre, so it stays right during a trackpad fling, a
 *   toolbar jump and a search jump without any of them owning it.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import type { Annotation } from "@workspace/interfaces";

import { cn } from "@workspace/ui/lib/utils";
import { AnnotationLayer } from "@workspace/ui/components/annotation/annotation-layer";
import type { AnnotationSurface } from "@workspace/ui/components/annotation/types";
import { PanZoomResetPill } from "@workspace/ui/components/pan-zoom/reset-button";
import {
  centroidOf,
  classifyTapEnd,
  isDoubleTap,
  spreadOf,
  TAP_SLOP,
} from "@workspace/ui/components/pan-zoom/recognizer";

import { createScrollInertia } from "@workspace/ui/components/pan-zoom/scroll-inertia";
import { useNavigationKey } from "@workspace/ui/components/pan-zoom/use-navigation-key";
import {
  pdfAnchorPoint,
  pdfAnchorDelta,
  pdfReanchorPending,
} from "./pdf-anchor";
import type { PdfZoomAnchor } from "./pdf-anchor";
import { pdfIsInitialView, pdfPinchFrame } from "./pdf-gesture";
import type { PdfPinchAnchor } from "./pdf-gesture";
import { PdfPage } from "./pdf-page";
import { PdfSidebar } from "./pdf-sidebar";
import { PdfToolbar } from "./pdf-toolbar";
import { usePdfDocument } from "./use-pdf-document";
import { readPdfProgress, writePdfProgress } from "./pdf-progress";
import { usePdfSearch } from "./use-pdf-search";
import {
  PDF_DEFAULT_MODE,
  PDF_MAX_DPR,
  PDF_MAX_PIXELS,
  PDF_MAX_SCALE,
  PDF_MIN_SCALE,
  PDF_ZOOM_STEPS,
  pdfSlotOf,
  pdfSlots,
  pdfSlotStartPage,
  pdfSpreadStep,
  pdfSurfacedPages,
  pdfZoomRaster,
  type PdfFitMode,
  type PdfOutlineEntry,
  type PdfSidebarTab,
  type PdfViewMode,
  type PdfViewerProps,
} from "./types";
import "./pdf-text-layer.css";

const FALLBACK_PAGE = { width: 595, height: 842 };

/** Space kept free around a page when a fit mode computes the multiplier. */
const FIT_PADDING = 48;

/**
 * Gap painted between the two pages of a 双页 slot. It has to be a *pixel*
 * amount because two pages keep their own width, so the fit maths subtracts it
 * from the viewport instead of scaling it — which means this number and the
 * `gap-2` class on the slot's inner row must agree. They do at the default 16px
 * root; under a different one the fit is a few pixels out, which at worst clips
 * a hairline off a page in 适配宽度.
 */
const SPREAD_GAP = 8;

/**
 * Multiplier change per pixel of wheel delta. A mouse notch reports 100px, i.e.
 * ×1.28 zooming in and ×0.78 zooming out (the mapping is exponential, so the two
 * directions are not symmetric); a trackpad pinch reports a stream of small
 * deltas that accumulate into the same feel.
 *
 * This is the *feel* knob only — it is not what makes a zoom smooth. A notch far
 * larger than this does not zoom faster, it just jumps further past
 * `PDF_ZOOM_STRETCH_LIMIT` and forces the repaint the deferral exists to avoid.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.01;

/**
 * How long a deferred zoom stays on the cheap path after its last notch, i.e.
 * how long the stretched bitmap may be on screen before pdfjs is re-run. Short
 * enough that a single wheel notch is crisp again almost at once, long enough
 * that a stream of notches never pays for a raster it is about to invalidate.
 */
const ZOOM_SETTLE_MS = 180;

/**
 * One line of a line-mode wheel event, in pixels. Firefox reports wheel deltas
 * in lines, and pdfjs itself converts them at 30px per line
 * (`web/pdf_viewer.mjs`, `normalizeWheelEventDelta`); anything smaller makes a
 * notch on that browser a fraction of a notch anywhere else.
 */
const WHEEL_LINE_HEIGHT = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Wheel deltas arrive in pixels, lines or pages depending on the device and the
 * browser (Firefox on Linux reports *lines*), and an un-normalised unit is the
 * difference between "zooms" and "does not move": three lines is `3`, which
 * would be a 0.7% step.
 */
function wheelDelta(event: WheelEvent, element: HTMLElement): number {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_HEIGHT;
  if (event.deltaMode === 2) return event.deltaY * element.clientHeight;
  return event.deltaY;
}

function downloadName(title: string | undefined): string {
  const base = (title || "document").replace(/[\\/:*?"<>|]+/g, "_").trim();
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

export function PdfViewer({
  url,
  title,
  coverUrl,
  className,
  defaultMode,
  defaultScale,
  defaultFit,
  annotations,
  onAnnotationsChange,
  compact,
  toolbarExtras,
  onPageChange,
  onError,
  progressKey,
}: PdfViewerProps) {
  const { t } = useI18n();

  const {
    status,
    readyUrl,
    pageCount,
    metrics,
    failure,
    progress,
    getPage,
    getTextContent,
    createTextLayer,
    getOutline,
  } = usePdfDocument(url);

  const [mode, setMode] = useState<PdfViewMode>(
    defaultMode ?? PDF_DEFAULT_MODE,
  );
  /**
   * 适配宽度 is the useful first view: the alternative is a 1:1 page that is
   * either clipped by the dialog or swimming in empty space.
   */
  const [fit, setFit] = useState<PdfFitMode>(
    defaultFit ?? (defaultScale === undefined ? "width" : "free"),
  );
  const [scale, setScale] = useState(defaultScale ?? 1);
  /**
   * The multiplier the visible bitmaps were actually rasterised at, which trails
   * the multiplier the boxes are laid out at while a gesture is streaming. `null`
   * means "no page has ever been stretched": a page renders at the laid-out
   * multiplier directly, so the first paint is never a stretched one.
   */
  const [paintedScale, setPaintedScale] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [sidebarTab, setSidebarTab] = useState<PdfSidebarTab | null>(null);
  const [visibleSlots, setVisibleSlots] = useState<ReadonlySet<number>>(
    () => new Set([1]),
  );
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [outline, setOutline] = useState<PdfOutlineEntry[] | null>(null);
  /**
   * The page boxes that currently have an ink canvas, bumped when one mounts or
   * unmounts. It is what `AnnotationLayer`'s `surfacesKey` is fed: a resize
   * observer cannot see an element it has never been handed, so a page arriving in
   * the rendering window has to be announced.
   */
  const [boxVersion, setBoxVersion] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { pressed: navigationPressed, pressedRef: navigationPressedRef } =
    useNavigationKey(rootRef);
  /**
   * Set by {@link resetView}, consumed by the layout effect that runs with the commit
   * which moved the boxes. `goToPage` measures the slots, so it has to run against
   * the layout it is about to scroll in — doing it inside the handler would measure
   * the previous multiplier's boxes.
   */
  const seatRef = useRef(false);
  const navigationTargetRef = useRef<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const slotRefs = useRef(new Map<number, HTMLDivElement>());
  const zoomAnchor = useRef<PdfZoomAnchor | null>(null);
  const scrollFrame = useRef(0);
  /**
   * Two multipliers, because they answer different questions. `scaleRef` is what
   * is *laid out* — the anchor maths needs it. `zoomTargetRef` is what the user
   * last *asked for*: a fast wheel spin delivers several notches before React has
   * re-rendered, and composing each notch on the laid-out scale instead of the
   * intended one silently swallows them, which is exactly what an insensitive
   * zoom feels like.
   */
  const scaleRef = useRef(1);
  const zoomTargetRef = useRef(1);
  const pageRef = useRef(1);
  const searchOpenRef = useRef(false);
  /**
   * The visual multiplier is written at most once a frame — React batching does
   * not merge wheel events (each is its own task), so without this a trackpad
   * pinch re-renders the strip per input event rather than per frame.
   */
  const zoomFrameRef = useRef(0);
  /** The newest multiplier a queued frame still owes the page boxes, if any. */
  const pendingScaleRef = useRef<number | null>(null);
  const rasterTimerRef = useRef(0);
  /** Set by a gesture handler: this scale change may paint by stretching. */
  const deferRasterRef = useRef(false);
  /**
   * The view the document opened at — what 双击 / 恢复位置大小 returns to, and
   * therefore also what decides whether the pill is on screen at all
   * (`pdfIsInitialView`). A ref because it must not follow the state it describes.
   */
  const openingRef = useRef({ fit: fit, scale: defaultScale ?? 1 });
  /** The page boxes the ink layer painters into, keyed by 1-based page. */
  const pageBoxesRef = useRef(new Map<number, HTMLDivElement>());
  /** `visibleSlots` as a ref: the surface list is built from a stable callback. */
  const visibleSlotsRef = useRef(visibleSlots);
  // Written during render for the same reason as `spreadRef` below: the layer reads
  // it from a *layout* effect, which runs before this component's passive effects —
  // a passive write would leave one measurement describing the previous window (a
  // scrollbar jump to page 40 would portal no canvas at all until something else
  // changed).
  visibleSlotsRef.current = visibleSlots;
  /**
   * The current spread as a ref, for the same reason: a page has to be mapped to
   * the *slot* that shows it before the visible set can be asked about it
   * (`visibleSlots` holds slot indices, not page numbers — in 双页 one slot is two
   * pages, and "is page 3 visible" is not "is slot 3 visible").
   */
  const spreadRef = useRef(mode.spread);
  // Written during render, like the canvas's `itemsRef`: the layer reads it from a
  // *layout* effect, and a passive-effect write can land after that read — which for
  // a 单页 ⇄ 双页 switch means one measurement with the previous mapping.
  spreadRef.current = mode.spread;
  /**
   * 手指=书写, reported by the ink layer. While it is on, one finger draws, so the
   * viewer's own one-finger pan has to stand down — otherwise a stroke would drag
   * the page out from under itself.
   */
  const touchDrawsRef = useRef(false);
  const annotationEnabledRef = useRef(false);
  const activeStrokeRef = useRef(false);
  const inertiaRef = useRef<ReturnType<typeof createScrollInertia> | null>(
    null,
  );

  const horizontal = mode.direction === "horizontal";
  const pagesPerSlot = pdfSpreadStep(mode.spread);

  const search = usePdfSearch({
    getTextContent,
    pageCount,
    enabled: status === "ready",
  });
  /** `useState` setter — stable, so the window listener binds once. */
  const setSearchOpen = search.setOpen;

  /* ---------------------------------------------------------------- *
   * Document-level reporting
   * ---------------------------------------------------------------- */

  useEffect(() => {
    if (failure) onError?.(failure);
  }, [failure, onError]);

  useEffect(() => {
    if (status === "ready") onPageChange?.(page, pageCount);
  }, [page, pageCount, status, onPageChange]);

  /** The host may reuse this component for another node; the paging state must not. */
  useEffect(() => {
    setPage(1);
    setOutline(null);
    setVisibleSlots(new Set([1]));
    // Another document's pages are not this document's pixels: whatever the last
    // gesture left painted does not describe anything in the new file.
    setPaintedScale(null);
    // Nor does a scroll offset computed against the old document's layout.
    zoomAnchor.current = null;
  }, [url]);

  useEffect(() => {
    if (status !== "ready" || sidebarTab !== "outline" || outline) return;
    let cancelled = false;
    void getOutline().then((entries) => {
      if (!cancelled) setOutline(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [status, sidebarTab, outline, getOutline]);

  /* ---------------------------------------------------------------- *
   * Geometry: viewport, fit, zoom
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () =>
      setViewport({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [status, sidebarTab]);

  /** The slot the reader is on — the unit every fit and snap is measured on. */
  const slotIndex = pdfSlotOf(page, mode.spread);

  /**
   * A slot's extent in PDF points at scale 1. 单页 it is the page itself; 双页 it
   * is both pages plus the gap between them, and as tall as the taller one — so
   * 适配页面 means "both pages are visible", not "one and a half of them".
   */
  const unitMetrics = useMemo(() => {
    const start = pdfSlotStartPage(slotIndex, mode.spread);
    const first = metrics.get(start) ?? metrics.get(1) ?? FALLBACK_PAGE;
    const paired =
      pagesPerSlot > 1 && start + 1 <= pageCount
        ? (metrics.get(start + 1) ?? metrics.get(1) ?? FALLBACK_PAGE)
        : null;
    return {
      width: first.width + (paired?.width ?? 0),
      height: Math.max(first.height, paired?.height ?? 0),
      gap: paired ? SPREAD_GAP : 0,
    };
  }, [slotIndex, mode.spread, pagesPerSlot, pageCount, metrics]);

  /** The multiplier a fit mode resolves to for the current slot and viewport. */
  const resolveFitScale = useCallback(
    (next: PdfFitMode): number => {
      if (next === "free") return clamp(scale, PDF_MIN_SCALE, PDF_MAX_SCALE);
      // The gap is a fixed pixel amount, so it comes off the viewport while the
      // pages themselves are scaled.
      const width = Math.max(1, viewport.width - FIT_PADDING - unitMetrics.gap);
      const height = Math.max(1, viewport.height - FIT_PADDING);
      if (next === "page") {
        return clamp(
          Math.min(width / unitMetrics.width, height / unitMetrics.height),
          PDF_MIN_SCALE,
          PDF_MAX_SCALE,
        );
      }
      // 适配宽度 follows the reading axis: full width when pages stack, full
      // height when they sit side by side.
      return clamp(
        horizontal ? height / unitMetrics.height : width / unitMetrics.width,
        PDF_MIN_SCALE,
        PDF_MAX_SCALE,
      );
    },
    [scale, viewport, unitMetrics, horizontal],
  );

  const effectiveScale = useMemo(
    () => resolveFitScale(fit),
    [resolveFitScale, fit],
  );

  /**
   * The multiplier the page bitmaps are painted at, which is what every page
   * takes as its `renderScale`. Until the first repaint records one it is the
   * laid-out multiplier, so the first paint is crisp rather than stretched.
   */
  const canvasScale = paintedScale ?? effectiveScale;

  /**
   * Publishes the multiplier the page boxes are laid out at, and answers the one
   * question a page has to ask before it rasterises: repaint now, or paint this
   * change by stretching the bitmap it already has?
   *
   * A layout effect rather than a passive one for two reasons. The anchor has to
   * move the scroll in the same frame as the reflow it compensates for; and a
   * step that repaints *now* has to land before the browser paints, otherwise
   * the stretched frame would be shown and then replaced by the crisp one.
   */
  useLayoutEffect(() => {
    scaleRef.current = effectiveScale;
    // A queued frame is *newer* than this commit, so it owns the intended
    // multiplier — syncing here would clobber it and swallow the notches it
    // carries. With nothing queued this commit is the truth (a resize, a fit
    // mode) and the next notch has to compose on it.
    if (pendingScaleRef.current === null)
      zoomTargetRef.current = effectiveScale;

    const defer = deferRasterRef.current;
    deferRasterRef.current = false;

    if (rasterTimerRef.current) {
      window.clearTimeout(rasterTimerRef.current);
      rasterTimerRef.current = 0;
    }

    const repaint = () => {
      rasterTimerRef.current = 0;
      setPaintedScale(effectiveScale);
    };

    // `paintedScale` is `null` until the first repaint records one; the policy
    // answers "now" for that, which is what seeds the baseline the next notch is
    // compared against. See `pdfZoomRaster`.
    const decision = pdfZoomRaster(effectiveScale, paintedScale, defer);
    if (decision === "skip") return;
    if (decision === "now") {
      repaint();
      return;
    }
    // "later": a gesture is in flight, so every page keeps the bitmap it has and
    // stretches it to the new box, and pdfjs is re-run once the gesture stops.
    // Deferred, never dropped — the box is already at `effectiveScale`, so the
    // pixels are the only part of the frame that is behind.
    rasterTimerRef.current = window.setTimeout(repaint, ZOOM_SETTLE_MS);
  }, [effectiveScale, paintedScale]);

  /** A deferred repaint or a queued frame must not outlive the viewer. */
  useEffect(
    () => () => {
      if (rasterTimerRef.current) window.clearTimeout(rasterTimerRef.current);
      if (zoomFrameRef.current) cancelAnimationFrame(zoomFrameRef.current);
      // Both are also reset, not just cancelled: a frame id left behind would
      // make `queueScale` skip scheduling for good, and a stranded multiplier
      // would be committed by the next zoom to arrive.
      zoomFrameRef.current = 0;
      pendingScaleRef.current = null;
    },
    [],
  );

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    searchOpenRef.current = search.open;
  }, [search.open]);

  /** Capture a page-local point rather than scaling the whole scroll offset:
   * page gutters, padding and auto margins do not scale with PDF page sizes.
   * Restore both axes from the page's actual post-layout rectangle.
   */
  const captureZoomAnchor = useCallback(
    (clientX?: number, clientY?: number): PdfZoomAnchor | null => {
      const element = scrollRef.current;
      if (!element) return null;
      const view = element.getBoundingClientRect();
      const originX = view.left + element.clientLeft;
      const originY = view.top + element.clientTop;
      const x = clientX ?? originX + element.clientWidth / 2;
      const y = clientY ?? originY + element.clientHeight / 2;
      const offsetX = x - originX;
      const offsetY = y - originY;
      const pending = zoomAnchor.current;
      if (pending && Math.abs(pending.scale - scaleRef.current) > 0.001) {
        const pageBox = pageBoxesRef.current.get(pending.page);
        if (pageBox)
          return pdfReanchorPending(
            pending,
            pageBox.getBoundingClientRect(),
            scaleRef.current,
            offsetX,
            offsetY,
          );
      }
      let nearest: PdfZoomAnchor | null = null;
      let distance = Infinity;
      // Usually only a handful of page rectangles are needed. Keep the full
      // fallback when the observer has not caught up with a pan yet.
      const candidates = pdfSurfacedPages(
        pageBoxesRef.current.keys(),
        visibleSlotsRef.current,
        spreadRef.current,
      );
      const scan = (numbers: Iterable<number>) => {
        for (const number of numbers) {
          const box = pageBoxesRef.current.get(number)?.getBoundingClientRect();
          if (!box || box.width <= 0 || box.height <= 0) continue;
          const dx = Math.max(box.left - x, 0, x - box.right);
          const dy = Math.max(box.top - y, 0, y - box.bottom);
          if (dx * dx + dy * dy >= distance) continue;
          distance = dx * dx + dy * dy;
          nearest = {
            page: number,
            ...pdfAnchorPoint(box, x, y),
            offsetX,
            offsetY,
            scale: scaleRef.current,
          };
        }
      };
      scan(candidates);
      if (distance > 0) scan(pageBoxesRef.current.keys());
      return nearest;
    },
    [],
  );

  const restoreZoomAnchor = useCallback((anchor: PdfZoomAnchor) => {
    const element = scrollRef.current;
    const box = pageBoxesRef.current.get(anchor.page);
    if (!element || !box) return;
    const view = element.getBoundingClientRect();
    const delta = pdfAnchorDelta(anchor, box.getBoundingClientRect(), {
      x: view.left + element.clientLeft,
      y: view.top + element.clientTop,
    });
    element.scrollLeft += delta.x;
    element.scrollTop += delta.y;
  }, []);

  const anchorScroll = useCallback(
    (target: number, clientX?: number, clientY?: number) => {
      const anchor = captureZoomAnchor(clientX, clientY);
      zoomAnchor.current =
        anchor && Math.abs(target - scaleRef.current) > 0.001
          ? { ...anchor, scale: target }
          : null;
    },
    [captureZoomAnchor],
  );

  /**
   * React does not batch wheel events — each one is dispatched in its own task —
   * so without this a trackpad pinch re-renders the whole strip per input event
   * instead of per frame. Only the newest multiplier is committed, which loses
   * nothing: the intended one is already in `zoomTargetRef` and every
   * intermediate frame is about to be superseded.
   */
  const flushScale = useCallback(() => {
    zoomFrameRef.current = 0;
    const next = pendingScaleRef.current;
    pendingScaleRef.current = null;
    if (next === null) return;
    // `fit` and `scale` land together. A `free` multiplier read before the scale
    // it belongs to would re-resolve to the *previous* one for a paint, which is
    // a visible jump away from the offset the anchor maths was computed against.
    setFit("free");
    setScale(next);
  }, []);

  const queueScale = useCallback(
    (next: number) => {
      pendingScaleRef.current = next;
      if (!zoomFrameRef.current) {
        zoomFrameRef.current = requestAnimationFrame(flushScale);
      }
    },
    [flushScale],
  );

  /**
   * Drop a multiplier a gesture queued but has not committed. Only a non-gesture
   * path needs this: a fit mode picked in the frame a wheel notch was queued for
   * would otherwise be overwritten by that notch when the frame ran.
   */
  const cancelQueuedScale = useCallback(() => {
    pendingScaleRef.current = null;
    if (zoomFrameRef.current) {
      cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = 0;
    }
  }, []);

  /**
   * The multiplier half of a zoom, with no opinion about the scroll.
   *
   * Split out for the pinch, which computes its own offset: a pinch frame is
   * composed from the gesture's anchor and is therefore already expressed in the
   * layout the new multiplier will create, so it must be *posted* as the pending
   * anchor rather than left to `anchorScroll`, whose ratio comes from the layout on
   * screen (see `pdfPinchFrame`).
   *
   * `defer` says whether this step belongs to a gesture that is still streaming:
   * a wheel notch or a pinch paints by stretching the bitmap it has, while a
   * button or a toolbar pick repaints at once — one deliberate step is not worth
   * a window of soft pixels.
   */
  const applyScale = useCallback(
    (next: number, defer = false) => {
      inertiaRef.current?.stop();
      const target = clamp(next, PDF_MIN_SCALE, PDF_MAX_SCALE);
      // Synced here rather than in an effect: the next notch of a fast spin has
      // to compose on this one even if React has not re-rendered.
      zoomTargetRef.current = target;
      // Assigned, not raised: a non-deferred step must not inherit a deferral a
      // gesture left behind, e.g. a pinch that ended at the clamp where the
      // queued multiplier stopped changing and so never committed again — which
      // is also why the flag needs `target` to be a *change*: at the clamp the
      // commit is a no-op, the effect never runs, and a flag raised there would
      // survive to soften the next resize.
      deferRasterRef.current = defer && target !== scaleRef.current;
      queueScale(target);
    },
    [queueScale],
  );

  const applyZoom = useCallback(
    (next: number, clientX?: number, clientY?: number, defer = false) => {
      applyScale(next, defer);
      anchorScroll(clamp(next, PDF_MIN_SCALE, PDF_MAX_SCALE), clientX, clientY);
    },
    [anchorScroll, applyScale],
  );

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    // Consumed before the scroller is checked: an anchor that cannot be applied
    // now (a loading document, an unmounted strip) must not be applied later,
    // when the boxes it was computed against no longer exist.
    if (!anchor) return;
    zoomAnchor.current = null;
    const element = scrollRef.current;
    if (!element) return;
    restoreZoomAnchor(anchor);
  }, [effectiveScale, restoreZoomAnchor]);

  /**
   * A fit mode changes the multiplier on its own, so it goes through the same
   * anchor: switching 适配宽度 → 适配页面 keeps the reader on the page they were
   * looking at instead of on whatever pixel offset happens to survive.
   */
  const applyFit = useCallback(
    (next: PdfFitMode) => {
      inertiaRef.current?.stop();
      // No "already selected" guard: it would have to read the committed `fit`,
      // and picking 适配宽度 on the same tick as a wheel zoom (which sets `free`)
      // would then be swallowed. Re-picking the active mode resolves to the scale
      // already laid out, and `anchorScroll` ignores a no-op change anyway.
      const target = resolveFitScale(next);
      zoomTargetRef.current = target;
      // A fit mode is a deliberate step, not a gesture: repaint at once, and let
      // go of a gesture's queued multiplier so it cannot land on top of this.
      deferRasterRef.current = false;
      cancelQueuedScale();
      anchorScroll(target);
      setFit(next);
    },
    [anchorScroll, cancelQueuedScale, resolveFitScale],
  );

  /**
   * The steps compose on the *intended* multiplier, not the laid-out one: two
   * clicks inside one frame would otherwise both step up from the same value and
   * the second would be lost.
   */
  const zoomIn = useCallback(() => {
    const base = zoomTargetRef.current;
    const next = PDF_ZOOM_STEPS.find((step) => step > base * 1.001);
    applyZoom(next ?? PDF_MAX_SCALE);
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    const base = zoomTargetRef.current;
    const next = [...PDF_ZOOM_STEPS]
      .reverse()
      .find((step) => step < base * 0.999);
    applyZoom(next ?? PDF_MIN_SCALE);
  }, [applyZoom]);

  /**
   * 恢复位置大小 — the one action behind the single-finger double tap, the `0` key
   * and the pill.
   *
   * It restores the **size** (the multiplier the document opened at, by fit mode
   * when there is one) and leaves the **position** where the reader is: `applyFit`
   * goes through the same scroll anchor every other zoom does, so the content under
   * the middle of the viewport stays there. Returning to page 1 instead would be a
   * literal reading of "恢复位置" and a hostile one — the reader is on page 40
   * because that is where they are reading.
   */
  /* ---------------------------------------------------------------- *
   * Navigation
   * ---------------------------------------------------------------- */

  /**
   * Jump to whichever slot shows `target`.
   *
   * In 双页 the *slot* is what a page number addresses: asking for page 4 lands on
   * the 3–4 spread and the viewer reports 3, so 上一页/下一页 walk spreads rather
   * than stepping twice into the same pair.
   *
   * `behavior` defaults to a smooth scroll (a navigation the reader asked for);
   * the layout changes pass `auto`, because there the scroll is a correction
   * that has to land in the same frame as the reflow.
   */
  const goToPage = useCallback(
    (target: number, behavior: ScrollBehavior = "smooth") => {
      const clamped = clamp(Math.round(target), 1, pageCount || 1);
      const index = pdfSlotOf(clamped, mode.spread);
      const next = pdfSlotStartPage(index, mode.spread);
      setPage(next);
      inertiaRef.current?.stop();
      // Fit can change with the destination's page dimensions. Smooth travel
      // through intermediate pages would keep changing its destination layout.
      // Jump, then re-seat after the target page's fit has committed.
      if (behavior === "smooth" && fit !== "free") {
        navigationTargetRef.current = next;
        behavior = "auto";
      }

      const element = scrollRef.current;
      const slot = slotRefs.current.get(index);
      if (!element || !slot) return;

      const elementRect = element.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      const offset = horizontal
        ? slotRect.left - elementRect.left
        : slotRect.top - elementRect.top;
      const overflow = horizontal
        ? slotRect.width - element.clientWidth
        : slotRect.height - element.clientHeight;
      // A slot smaller than the viewport is centred; a slot larger than it is
      // aligned to its leading edge so its first words are what you land on.
      const lead = overflow > 0 ? 0 : -overflow / 2;

      if (horizontal) {
        element.scrollTo({
          left: element.scrollLeft + offset + lead,
          behavior,
        });
      } else {
        element.scrollTo({
          top: element.scrollTop + offset + lead,
          behavior,
        });
      }
    },
    [pageCount, horizontal, mode.spread, fit],
  );

  /**
   * The reading position, restored once per loaded document.
   *
   * `readyUrl` rather than `status` is the trigger: a url change re-renders with
   * the previous document's `ready` status and the new url before
   * `usePdfDocument` has published `loading`, so a restore gated on `status`
   * alone would run against a document that is not there yet and then be
   * consumed. `readyUrl` only equals `url` once the new document is the one
   * that is ready.
   */
  const restoredProgress = useRef<{
    url: string;
    key: string;
    /** The page the restore jump targets. */
    page: number;
    /** The page that was current before the jump was queued. */
    before: number;
    /** The jump has landed; after this the write is free to follow the reader. */
    landed: boolean;
  } | null>(null);

  useEffect(() => {
    if (readyUrl === null || readyUrl !== url || !progressKey) return;
    // The slots `goToPage` measures are laid out from `viewport`. On the very
    // first `ready` commit the scroller has only just mounted, so the
    // measurement effect below has not run yet: 适配 resolves against a 0×0 box,
    // i.e. the minimum multiplier, and every slot is a fraction of its real
    // height. Seating the stored page against *that* layout lands the reader
    // early once the measurement grows the strip by the ratio of the two scales
    // (a stored 18 opened at 3, a stored 116 at 15). Waiting one commit for a
    // real box is what keeps the jump on the page that was stored.
    if (viewport.width <= 0 || viewport.height <= 0) return;
    const restored = restoredProgress.current;
    if (restored && restored.url === readyUrl && restored.key === progressKey) {
      return;
    }
    const stored = readPdfProgress(progressKey);
    const requested =
      stored !== null && stored > 1 && stored <= pageCount ? stored : 1;
    // `goToPage` seats the slot's *leading* page in 双页, so remember where the
    // jump plans to land rather than what was asked for: the write below uses it
    // to tell the pre-restore page apart from a landing it did not name.
    const landing = pdfSlotStartPage(
      pdfSlotOf(requested, mode.spread),
      mode.spread,
    );
    restoredProgress.current = {
      url: readyUrl,
      key: progressKey,
      page: landing,
      before: page,
      landed: false,
    };
    // Always seat, even at page 1: the host keys the viewer by url, so switching
    // between two nodes that share one file reuses this instance without the
    // url-reset effect firing, and a node with no saved position must still open
    // at its first page rather than inherit the previous node's.
    goToPage(requested, "auto");
  }, [
    readyUrl,
    url,
    progressKey,
    pageCount,
    mode.spread,
    goToPage,
    viewport.width,
    viewport.height,
    // `page` is read as the pre-restore position, and a scroll that changes it
    // before a real viewport exists has to be the position the write gate sees.
    page,
  ]);

  /**
   * The reading position, written as the reader moves.
   *
   * It skips the first ready commit, which still holds the pre-restore page
   * while the jump is only queued; writing there would erase the position being
   * restored. From the first page the reader actually lands on it persists.
   */
  useEffect(() => {
    if (readyUrl === null || readyUrl !== url || !progressKey) return;
    const restored = restoredProgress.current;
    if (
      !restored ||
      restored.url !== readyUrl ||
      restored.key !== progressKey
    ) {
      return;
    }
    if (!restored.landed) {
      // The commit that publishes `ready` still holds the pre-restore page while
      // `goToPage` has only queued the jump; writing that page would erase the
      // stored position. Wait for the first page that is not that pre-restore
      // one, and then persist it — including a landing the jump did not name
      // exactly. Requiring `page === restored.page` here froze persistence for a
      // document whose jump landed a slot off (mixed page sizes, a clamped end
      // of document, a layout switch while the document opened): the guard never
      // cleared, so nothing was ever written again and the next open started at
      // page 1.
      if (page === restored.before && page !== restored.page) return;
      restored.landed = true;
    }
    writePdfProgress(progressKey, page);
  }, [page, readyUrl, url, progressKey]);

  useLayoutEffect(() => {
    const target = navigationTargetRef.current;
    if (target === null) return;
    navigationTargetRef.current = null;
    goToPage(target, "auto");
  }, [page, effectiveScale, goToPage]);

  const resetView = useCallback(() => {
    const opening = openingRef.current;
    const target =
      opening.fit === "free" ? opening.scale : resolveFitScale(opening.fit);
    if (Math.abs(target - scaleRef.current) <= 0.001) {
      // The **size** is already what it should be — the reader only panned, or tapped
      // twice — so nothing will commit and move the boxes. Seat the page here,
      // against the layout that exists: without this branch a double tap in the
      // middle of a long page would do nothing at all, which is not what 恢复位置大小
      // offers.
      goToPage(pageRef.current, "auto");
      return;
    }
    if (opening.fit === "free") applyZoom(opening.scale);
    else applyFit(opening.fit);
    // The size *is* about to change, so the position half has to wait for the commit
    // that moves the boxes: `goToPage` measures the slots, and they are still laid
    // out at the multiplier being replaced.
    seatRef.current = true;
  }, [applyFit, applyZoom, goToPage, resolveFitScale]);

  /**
   * Has the reader left the opening view? The pdf's `isIdentityTransform`, and the
   * gate on the 恢复位置大小 pill. Numeric, against what the opening fit resolves to
   * for *this* viewport: a window resize must not summon the pill (the reader did
   * nothing) and picking the very same multiplier from the toolbar must not either.
   */
  const openingScale = openingRef.current;
  const atOpeningView = pdfIsInitialView(
    effectiveScale,
    openingScale,
    openingScale.fit === "free"
      ? openingScale.scale
      : resolveFitScale(openingScale.fit),
  );

  /**
   * `resetView` read from inside the gesture effect, which must keep a stable
   * identity for the whole of a touch sequence (see the double-tap branch).
   */
  const resetViewRef = useRef(resetView);
  useEffect(() => {
    resetViewRef.current = resetView;
  }, [resetView]);

  const handleScroll = useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const element = scrollRef.current;
      if (!element) return;
      const elementRect = element.getBoundingClientRect();
      const centre = horizontal
        ? elementRect.left + element.clientWidth / 2
        : elementRect.top + element.clientHeight / 2;

      let best = 0;
      let bestDistance = Infinity;
      slotRefs.current.forEach((slot, number) => {
        const rect = slot.getBoundingClientRect();
        const middle = horizontal
          ? rect.left + rect.width / 2
          : rect.top + rect.height / 2;
        const distance = Math.abs(middle - centre);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = number;
        }
      });

      // The nearest *slot* names the page as its leading page, so a 双页 strip
      // never reports the right-hand page of a pair it is showing.
      if (best > 0) {
        const next = pdfSlotStartPage(best, mode.spread);
        setPage((current) => (current === next ? current : next));
      }
    });
  }, [horizontal, mode.spread]);

  useEffect(
    () => () => {
      if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  /**
   * Every one of the three layout switches reflows the strip under a fixed pixel
   * offset, so the reader has to be re-seated *and* the scroll has to move with
   * them: 单双页 decides how many pages a slot holds (双页 halves the slot count,
   * so the same offset lands about twice as far in), 方向 switches to the other
   * axis, where the old offset does not exist at all, and 翻页 stretches the slot
   * pitch to at least a viewport, which pushes every following slot further in
   * than 连续 left it. Nothing else would correct any of them — the offset stays
   * in range, so no scroll event fires and `handleScroll` never re-derives,
   * leaving the counter and the rail pointing at a page that is not on screen. A
   * layout effect, so the correction lands in the same frame as the reflow (no
   * flash of the wrong position), and `auto` because it is a correction rather
   * than a navigation the reader asked for.
   */
  const layoutKey = `${mode.direction}:${mode.scroll}:${mode.spread}`;
  const layoutRef = useRef(layoutKey);
  useLayoutEffect(() => {
    if (layoutRef.current === layoutKey) return;
    layoutRef.current = layoutKey;
    goToPage(page, "auto");
  }, [layoutKey, page, goToPage]);

  /**
   * 恢复位置大小, the position half: re-seat the page the reader is on.
   *
   * A pending flag consumed by the commit that changed the multiplier, exactly like
   * the zoom anchor — `resetView` cannot scroll itself, because at that moment the
   * slots are still laid out at the multiplier it is replacing.
   */
  useLayoutEffect(() => {
    if (!seatRef.current) return;
    seatRef.current = false;
    goToPage(pageRef.current, "auto");
  }, [effectiveScale, goToPage]);

  /* ---------------------------------------------------------------- *
   * Rendering window
   * ---------------------------------------------------------------- */

  const registerSlot = useCallback(
    (number: number, element: HTMLDivElement | null) => {
      const previous = slotRefs.current.get(number);
      if (element) {
        slotRefs.current.set(number, element);
        observerRef.current?.observe(element);
      } else if (previous) {
        slotRefs.current.delete(number);
        observerRef.current?.unobserve(previous);
      }
    },
    [],
  );

  /**
   * A page box arrived (or left) — remember it for the ink layer.
   *
   * `pageBoxesRef` is a ref and `boxVersion` is the signal: the surface list is
   * read by a callback the layer calls on its own schedule (a measurement), so it
   * must not be a snapshot of a render.
   */
  const handlePageBox = useCallback(
    (pageNumber: number, element: HTMLDivElement | null) => {
      const boxes = pageBoxesRef.current;
      if (element) {
        if (boxes.get(pageNumber) === element) return;
        boxes.set(pageNumber, element);
      } else if (!boxes.delete(pageNumber)) {
        return;
      }
      setBoxVersion((current) => current + 1);
    },
    [],
  );

  /**
   * The ink surfaces, read on demand by the layer.
   *
   * Only the pages in the rendering window get one: the page *boxes* all exist
   * (the strip renders every slot), but an ink canvas each would allocate a
   * backing store per page of the document. The window is the same one the page
   * bitmaps use, with the same one-viewport margin, so the ink is always mounted
   * before its page can be seen.
   */
  const getSurfaces = useCallback((): readonly AnnotationSurface[] => {
    const boxes = pageBoxesRef.current;
    const surfaces: AnnotationSurface[] = [];
    // Via each page's slot — see `pdfSurfacedPages` for why the page number is not
    // the thing `visibleSlots` lists.
    for (const pageNumber of pdfSurfacedPages(
      boxes.keys(),
      visibleSlotsRef.current,
      spreadRef.current,
    )) {
      const element = boxes.get(pageNumber);
      if (!element) continue;
      // 0-based: the number `Annotation.page` stores and the layer filters on.
      surfaces.push({ page: pageNumber - 1, element });
    }
    return surfaces;
  }, []);

  /**
   * Announced to the layer when the surface *set* changes, **and** whenever the
   * boxes it has already been handed move or resize.
   *
   * A page resizing looks like something the layer's resize observers cover, and
   * it would be, one frame late: the boxes are laid out by the commit that reads
   * this key, so a key that carried the multiplier is how the layer re-measures
   * *inside* that commit — before the browser paints. Without it a page canvas
   * (which is pinned to its page box with `inset: 0`, so its CSS box moves the
   * moment the layout does) would be a frame out of step with its own backing
   * store on every zoom step, and the compositor would resample the ink once per
   * frame: the shimmer the reader saw. A page's *size* changing for any other
   * reason (a window resize, a font reflow) still arrives through the observers.
   */
  const surfacesKey = useMemo(() => {
    const pages = Array.from(visibleSlots).sort((a, b) => a - b);
    // The layout is part of the key, not decoration: switching 单页 ⇄ 双页 changes
    // which pages a slot index *means* without resizing a single page box — so no
    // resize observer fires, and the key is the only thing that can tell the layer
    // that its surface list now describes a different set of pages. The multiplier
    // is the same argument one step down: the surface list is unchanged and every
    // box in it just got bigger.
    return [
      boxVersion,
      mode.direction,
      mode.scroll,
      mode.spread,
      effectiveScale,
      pages.join(","),
    ].join(":");
  }, [
    boxVersion,
    effectiveScale,
    mode.direction,
    mode.scroll,
    mode.spread,
    visibleSlots,
  ]);

  /**
   * The ink layer's 手指=书写 switch. A ref rather than state: it only changes what
   * the *next* pointer does, and re-rendering the strip for it would buy nothing.
   */
  const handleTouchDrawsChange = useCallback((next: boolean) => {
    touchDrawsRef.current = next;
  }, []);

  /**
   * One finished ink gesture, forwarded to the host unchanged.
   *
   * The page number is already on the item — the layer stamps it from the surface
   * the stroke happened on — so this is a pass-through, and the viewer deliberately
   * knows nothing about the shape of what it carries.
   */
  const handleAnnotationsChange = useCallback(
    (items: Annotation[]) => {
      onAnnotationsChange?.(items);
    },
    [onAnnotationsChange],
  );

  /**
   * One stable ref callback per page. An inline arrow is a new function every
   * render, so React detaches (`ref(null)`) and re-attaches every slot — two
   * calls per page per render, plus an unobserve/observe storm in the observer.
   */
  const slotCallbacks = useRef(
    new Map<number, (element: HTMLDivElement | null) => void>(),
  );
  const slotRef = useCallback(
    (number: number) => {
      const cache = slotCallbacks.current;
      let callback = cache.get(number);
      if (!callback) {
        callback = (element) => registerSlot(number, element);
        cache.set(number, callback);
      }
      return callback;
    },
    [registerSlot],
  );

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || status !== "ready") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleSlots((previous) => {
          const next = new Set(previous);
          let changed = false;
          for (const entry of entries) {
            const number = Number(
              (entry.target as HTMLElement).dataset.pdfSlot,
            );
            if (!number) continue;
            if (entry.isIntersecting) {
              if (!next.has(number)) {
                next.add(number);
                changed = true;
              }
            } else if (next.delete(number)) {
              changed = true;
            }
          }
          return changed ? next : previous;
        });
      },
      {
        root,
        // The margin belongs on the axis the *slots* run along — the one `方向`
        // chooses. A page has to be mounted before it can be seen, so a 水平 strip
        // with a fixed vertical margin only ever mounted a page once it was already
        // on screen, and the reader watched it paint. The cross axis keeps 0: a slot
        // is viewport-sized there, so nothing arrives in it from off-screen.
        rootMargin: horizontal
          ? "0px 1000px 0px 1000px"
          : "1000px 0px 1000px 0px",
      },
    );
    observerRef.current = observer;
    slotRefs.current.forEach((slot) => observer.observe(slot));
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [horizontal, status]);

  /* ---------------------------------------------------------------- *
   * Gestures
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || status !== "ready") return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (activeStrokeRef.current) return;
      event.preventDefault();
      inertiaRef.current?.stop();
      const factor = Math.exp(
        -wheelDelta(event, element) * WHEEL_ZOOM_SENSITIVITY,
      );
      // Composed on the *intended* multiplier: a fast spin or a trackpad pinch
      // delivers a whole burst of events before React commits, and each one has
      // to build on the last or the gesture is thrown away. Deferred, because
      // this is exactly the stream of events that must not each start a raster.
      applyZoom(
        zoomTargetRef.current * factor,
        event.clientX,
        event.clientY,
        true,
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [applyZoom, status]);

  /**
   * The pdf's own viewport gestures, on the element every pointer lands on.
   *
   * The scroller is the gesture surface here, not the ink canvas: the canvas
   * covers each *page*, so a finger in the gutter between two pages — or on the
   * letterbox of a narrower page — would otherwise be invisible to the pinch. The
   * canvases still see the same events (they bubble), which is why the pen is
   * claimed there and never here.
   *
   * `touch-action: none` on the scroller (see the render) is what makes this the
   * only path: with it the browser hands us every touch instead of panning
   * natively, so one finger scrolls the strip at exactly the finger's pace and two
   * fingers pinch and pan together.
   */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || status !== "ready") return;

    interface Tracked {
      x: number;
      y: number;
      downX: number;
      downY: number;
    }

    const pointers = new Map<number, Tracked>();
    const inertia = createScrollInertia(element);
    inertiaRef.current = inertia;
    let mouseDrag: { id: number; x: number; y: number } | null = null;
    /**
     * The pinch baseline — the whole view when the fingers last (re)anchored, which
     * is what every frame is composed from. It carries the *offset* too: a frame is
     * absolute (`pdfPinchFrame`), so the pan the fingers ask for is expressed
     * against this snapshot rather than added to the live offset once per sample.
     */
    let anchor: PdfPinchAnchor | null = null;
    let pinchPoint: PdfZoomAnchor | null = null;
    /** Tap bookkeeping for 单指双击 (see `classifyTapEnd` / `isDoubleTap`). */
    let startedAt = 0;
    let peak = 0;
    let moved = false;
    let lastTap: { time: number; x: number; y: number } | null = null;
    /**
     * A pen is on the surface. Its own pointer goes to the ink canvas, but a palm
     * resting beside it arrives here as a touch and must not drag the page out from
     * under the stroke that is being written — the rule the ink layer applies to its
     * own pointers (`use-annotation-input.ts`, `penIsDown`), applied to the
     * scroller's gestures.
     */
    const penPointers = new Set<number>();
    const penIsDown = () => penPointers.size > 0;
    /**
     * Where the scroller's viewport starts, in client coordinates — the last piece
     * of `pdfPinchFrame`'s arithmetic. Read once per (re)anchor rather than per
     * sample: it is a forced layout, and the scroller's own box does not move during
     * a gesture.
     */
    let viewportOrigin = { x: 0, y: 0 };

    const reanchor = () => {
      if (pointers.size < 2) {
        anchor = null;
        return;
      }
      const values = [...pointers.values()];
      const centre = centroidOf(values);
      const rect = element.getBoundingClientRect();
      viewportOrigin = {
        x: rect.left + element.clientLeft,
        y: rect.top + element.clientTop,
      };
      /**
       * The scale and the offset have to describe the *same* layout. `zoomTargetRef`
       * is what the reader asked for, which can be one commit ahead of the layout on
       * screen — and in that window the offset that belongs to it is the one waiting
       * in `zoomAnchor` (posted by the pinch or by the wheel), not the one the
       * scroller is still showing. Pairing a requested scale with a stale offset
       * would put every following frame out by the ratio between them.
       */
      const target = zoomTargetRef.current;
      pinchPoint = captureZoomAnchor(centre.x, centre.y);
      anchor = {
        scale: target,
        spread: spreadOf(values, centre),
        midX: centre.x,
        midY: centre.y,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
      };
    };

    /**
     * Forget every pointer. A touch sequence that the browser takes away (a tab
     * switch, a lock screen, a focus trap) delivers no `pointerup`, and a table that
     * still holds fingers from minutes ago turns the next touch into a pinch against
     * a finger set that does not exist.
     */
    const resetPointers = () => {
      dropTouches();
      mouseDrag = null;
      element.style.cursor = "";
      inertia.stop();
      lastTap = null;
      // A tab that goes away takes the pen's `pointerup` with it; the next touch
      // must not be measured against a hand that is no longer there.
      penPointers.clear();
    };

    /**
     * Forget the touches without touching the pen flag: the pen commands the page,
     * and a palm that was already down when it landed must stop scrolling at once
     * (its `pointermove`s keep arriving, and a page that slides under the nib puts
     * the ink somewhere the reader did not draw).
     */
    function dropTouches() {
      pointers.clear();
      anchor = null;
      peak = 0;
      moved = false;
    }

    const onPointerDown = (event: PointerEvent) => {
      inertia.stop();
      if (event.pointerType === "pen") {
        // Tracked, never handled: the pen draws (the ink canvas has it) and its
        // presence is what keeps a resting palm from scrolling the page. A palm that
        // arrived *first* is dropped here rather than only refused for new fingers.
        penPointers.add(event.pointerId);
        dropTouches();
        return;
      }
      // Ordinary left clicks select text or draw; middle/space drag grabs paper.
      if (event.pointerType === "mouse") {
        if (
          event.button !== 1 &&
          !(event.button === 0 && navigationPressedRef.current)
        )
          return;
        const target = event.target as HTMLElement | null;
        if (
          target?.closest(
            "a, button, input, textarea, [contenteditable='true']",
          )
        )
          return;
        // Leave actual scrollbars to the browser.
        const box = element.getBoundingClientRect();
        if (
          event.clientX >=
            box.left + element.clientLeft + element.clientWidth ||
          event.clientY >= box.top + element.clientTop + element.clientHeight
        )
          return;
        event.preventDefault();
        mouseDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        element.style.cursor = "grabbing";
        return;
      }
      // Palm rejection: while the pen is down every touch is dropped, so a resting
      // hand cannot pan the page the pen is writing on.
      if (penIsDown()) return;
      if (event.target === element) {
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          /* Capture can be unavailable. */
        }
      }
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        downX: event.clientX,
        downY: event.clientY,
      });
      if (pointers.size === 1) {
        startedAt = event.timeStamp;
        peak = 1;
        moved = false;
      } else {
        peak = Math.max(peak, pointers.size);
        reanchor();
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      // The pen owns the surface: a touch sequence from before it landed is over.
      if (penIsDown()) {
        if (pointers.size > 0) dropTouches();
        return;
      }
      const tracked = pointers.get(event.pointerId);
      if (!tracked) return;
      // The pointer's *own* previous sample, not a shared "last position": after a
      // pinch the surviving finger must continue from where it is, and a shared
      // baseline would still hold the position the pinch started from — a jump of
      // however far the fingers travelled.
      const previousX = tracked.x;
      const previousY = tracked.y;
      tracked.x = event.clientX;
      tracked.y = event.clientY;
      if (
        Math.hypot(
          event.clientX - tracked.downX,
          event.clientY - tracked.downY,
        ) > TAP_SLOP
      ) {
        moved = true;
      }

      if (pointers.size >= 2 && anchor) {
        const values = [...pointers.values()];
        const midX = values.reduce((sum, p) => sum + p.x, 0) / values.length;
        const midY = values.reduce((sum, p) => sum + p.y, 0) / values.length;
        const spread = spreadOf(values, { x: midX, y: midY });
        // A pinch is never a tap, even when neither finger travels further than
        // `TAP_SLOP` from where it went down: without this a small quick pinch would
        // open the double-tap window and the next single tap would reset the view.
        if (Math.abs(spread - anchor.spread) > TAP_SLOP) moved = true;
        const frame = pdfPinchFrame(
          anchor,
          { spread, midX, midY },
          viewportOrigin,
        );
        if (!frame) return;
        event.preventDefault();
        // A pinch is a stream of moves, so it paints by stretching and repaints
        // when the fingers stop — one raster per gesture, not one per move.
        const target = clamp(frame.scale, PDF_MIN_SCALE, PDF_MAX_SCALE);
        if (Math.abs(target - scaleRef.current) > 0.001) {
          // The multiplier is about to change, so the whole layout is about to be
          // rescaled: the frame's offset is expressed in the *new* layout and is
          // therefore posted as the pending anchor, which the commit that moves the
          // boxes consumes (`anchorScroll` cannot be used here — its ratio comes from
          // the layout on screen, which is the one being replaced).
          zoomAnchor.current = pinchPoint
            ? {
                ...pinchPoint,
                scale: target,
                offsetX: midX - viewportOrigin.x,
                offsetY: midY - viewportOrigin.y,
              }
            : null;
          applyScale(frame.scale, true);
          return;
        }
        // Only the fingers moved: the layout is not going to change, so the offset is
        // valid right now — and a no-op multiplier commit would never consume a
        // pending anchor at all. Anything still queued from an earlier frame is
        // therefore *disarmed* rather than left to be applied by some unrelated
        // reflow, which is the rule `anchorScroll` follows for the same reason.
        zoomAnchor.current = null;
        if (pinchPoint)
          restoreZoomAnchor({
            ...pinchPoint,
            offsetX: midX - viewportOrigin.x,
            offsetY: midY - viewportOrigin.y,
          });
        return;
      }

      if (pointers.size === 1) {
        // 手指=书写: the finger is a pen, and the ink canvas is drawing with it.
        if (annotationEnabledRef.current && touchDrawsRef.current) return;
        event.preventDefault();
        const dx = previousX - event.clientX;
        const dy = previousY - event.clientY;
        element.scrollLeft += dx;
        element.scrollTop += dy;
        inertia.sample(dx, dy, event.timeStamp);
      }
    };

    const onPointerEnd = (event: PointerEvent) => {
      const tracked = pointers.get(event.pointerId);
      if (!tracked) return;
      pointers.delete(event.pointerId);

      if (pointers.size > 0) {
        reanchor();
        return;
      }

      if (
        event.type === "pointerup" &&
        peak === 1 &&
        moved &&
        !(annotationEnabledRef.current && touchDrawsRef.current)
      )
        inertia.start(event.timeStamp);
      // The sequence is over: it was a tap if nothing moved and it did not last.
      const outcome = classifyTapEnd({
        tap: event.type === "pointerup",
        touch: true,
        moved,
        duration: event.timeStamp - startedAt,
        peak,
      });
      const at = { x: event.clientX, y: event.clientY };
      moved = false;
      peak = 0;
      anchor = null;

      if (outcome !== "tap") {
        // Any sequence that is not a clean single-finger tap closes the
        // double-tap window: 双击 must be two taps in a row, not "tap … pan …
        // tap", whose second tap would otherwise reset the view.
        lastTap = null;
        return;
      }
      // 手指=书写 turns a one-finger tap into a dot, so it must not also be the
      // first half of a double tap (the image host's rule, same reason).
      if (annotationEnabledRef.current && touchDrawsRef.current) return;

      if (isDoubleTap(lastTap, { time: event.timeStamp, ...at })) {
        lastTap = null;
        // Through a ref: `resetView` is rebuilt whenever the viewport or the
        // multiplier changes, and this effect must NOT re-attach mid-gesture —
        // the tracked pointers live in its closure, so a re-attach would drop a
        // pinch the moment its first frame landed.
        resetViewRef.current();
        return;
      }
      lastTap = { time: event.timeStamp, ...at };
    };

    /**
     * The pen's end, wherever it lands.
     *
     * By id and on `window`: a pen that goes down in the gutter takes no pointer
     * capture, so its `pointerup` may arrive over the toolbar, the sidebar or another
     * window — none of which are inside the scroller — and a stranded flag would
     * leave every later touch dropped. Two styluses are tracked separately for the
     * same reason.
     */
    const onMouseMove = (event: PointerEvent) => {
      if (!mouseDrag || mouseDrag.id !== event.pointerId) return;
      event.preventDefault();
      element.scrollLeft += mouseDrag.x - event.clientX;
      element.scrollTop += mouseDrag.y - event.clientY;
      mouseDrag.x = event.clientX;
      mouseDrag.y = event.clientY;
    };
    const onMouseEnd = (event: PointerEvent) => {
      if (mouseDrag?.id !== event.pointerId) return;
      mouseDrag = null;
      element.style.cursor = "";
    };
    const onPenEnd = (event: PointerEvent) => {
      if (event.pointerType === "pen") penPointers.delete(event.pointerId);
    };

    /**
     * The two end signals that are not pointer events on the scroller, plus the
     * capture loss that is not a `pointerup` either. All of them clear the whole
     * table: the design's rule for a gesture surface (`annotation.md` §4.6-5), and
     * the difference between "no fingers down" and "a pinch against ghosts".
     */
    const onHidden = () => {
      if (document.visibilityState === "hidden") resetPointers();
    };
    const onLostCapture = (event: PointerEvent) => {
      if (event.pointerType === "pen") penPointers.delete(event.pointerId);
      if (pointers.has(event.pointerId)) resetPointers();
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerEnd);
    element.addEventListener("pointercancel", onPointerEnd);
    element.addEventListener("lostpointercapture", onLostCapture);
    window.addEventListener("pointermove", onMouseMove);
    window.addEventListener("pointerup", onMouseEnd);
    window.addEventListener("pointercancel", onMouseEnd);
    element.addEventListener("wheel", inertia.stop, { passive: true });
    window.addEventListener("pointerup", onPenEnd);
    window.addEventListener("pointercancel", onPenEnd);
    window.addEventListener("lostpointercapture", onPenEnd);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", resetPointers);
    return () => {
      inertia.stop();
      inertiaRef.current = null;
      element.style.cursor = "";
      window.removeEventListener("pointermove", onMouseMove);
      window.removeEventListener("pointerup", onMouseEnd);
      window.removeEventListener("pointercancel", onMouseEnd);
      element.removeEventListener("wheel", inertia.stop);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerEnd);
      element.removeEventListener("pointercancel", onPointerEnd);
      element.removeEventListener("lostpointercapture", onLostCapture);
      window.removeEventListener("pointerup", onPenEnd);
      window.removeEventListener("pointercancel", onPenEnd);
      window.removeEventListener("lostpointercapture", onPenEnd);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", resetPointers);
    };
    // Stable gesture callbacks keep pointer tracking alive across zoom commits;
    // changing the document layout explicitly starts a new gesture scope.
  }, [
    applyScale,
    captureZoomAnchor,
    restoreZoomAnchor,
    status,
    layoutKey,
    navigationPressedRef,
  ]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const modifier = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement | null;
      const inField = Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']"),
      );
      // A field owns its keys (arrow keys move the caret, not the page). The one
      // exception is the search shortcut, which has to work from anywhere.
      if (inField && !(modifier && (event.key === "f" || event.key === "F"))) {
        return;
      }

      if (modifier && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        search.setOpen(true);
        return;
      }
      if (modifier && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (modifier && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        zoomOut();
        return;
      }
      // 恢复位置大小, the keyboard twin of the single-finger double tap. It lives
      // here rather than only in the ink layer because the layer's handler covers its
      // own subtree, while the reader's focus is often the scroller it does not own
      // (a click in the gutter, or 浏览 mode where the ink canvas takes no pointers).
      if (event.key === "0") {
        event.preventDefault();
        resetViewRef.current();
        return;
      }
      // Escape is owned by the window-capture listener above while the search
      // bar is open; with it closed the dialog above keeps its own Escape.
      if (event.key === "PageDown") {
        event.preventDefault();
        goToPage(page + pagesPerSlot);
        return;
      }
      if (event.key === "PageUp") {
        event.preventDefault();
        goToPage(page - pagesPerSlot);
        return;
      }
      if (modifier && event.key === "Home") {
        event.preventDefault();
        goToPage(1);
        return;
      }
      if (modifier && event.key === "End") {
        event.preventDefault();
        goToPage(pageCount);
        return;
      }
      if (mode.scroll === "paged") {
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          event.preventDefault();
          goToPage(page + pagesPerSlot);
        } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          event.preventDefault();
          goToPage(page - pagesPerSlot);
        }
      }
    },
    [
      search,
      zoomIn,
      zoomOut,
      goToPage,
      page,
      pageCount,
      pagesPerSlot,
      mode.scroll,
    ],
  );

  /* ---------------------------------------------------------------- *
   * Search jumps
   * ---------------------------------------------------------------- */

  const activeMatchPage = search.activeMatch?.page ?? null;
  const goToPageRef = useRef(goToPage);
  useEffect(() => {
    goToPageRef.current = goToPage;
  }, [goToPage]);

  /**
   * Jump on *hit changes* only, and only when the hit is on another *slot*: a hit
   * inside the spread already on screen is better served by the rect-level
   * `scrollIntoView` in `PdfPage`, and firing both at once leaves them fighting
   * over the scroll position. `page` is deliberately not a dependency — once the
   * user scrolls away from a hit, the viewer must not drag them back.
   */
  useEffect(() => {
    if (
      activeMatchPage &&
      pdfSlotOf(activeMatchPage, mode.spread) !==
        pdfSlotOf(pageRef.current, mode.spread)
    ) {
      goToPageRef.current(activeMatchPage);
    }
  }, [activeMatchPage, search.activePosition, mode.spread]);

  /**
   * Escape belongs to the search bar while it is open.
   *
   * This has to be a *window* capture listener: Radix dismisses layers from a
   * `document` capture listener (see `@radix-ui/react-dismissable-layer`, which
   * only calls `onDismiss` when the event is not default-prevented), and every
   * React handler runs after it. Preventing the default here is therefore the
   * only way to keep the keystroke from closing the node editor dialog behind
   * us. The target check keeps it local: a dropdown's content is portalled
   * outside this subtree, so its own Escape handling is untouched.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !searchOpenRef.current) return;
      const target = event.target as Node | null;
      if (!target || !rootRef.current?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [setSearchOpen]);

  /* ---------------------------------------------------------------- *
   * Download
   * ---------------------------------------------------------------- */

  const handleDownload = useCallback(() => {
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = downloadName(title);
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      } catch {
        // The file lives on the API origin: without CORS headers a `download`
        // attribute is ignored, so the honest fallback is to open it.
        window.open(url, "_blank", "noopener,noreferrer");
      }
    })();
  }, [url, title]);

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  const paged = mode.scroll === "paged";
  const axis = horizontal ? "x" : "y";

  /**
   * The strip's slots: what the observer watches, what snapping snaps to, and
   * what a page number addresses. 单页 is one page per slot; 双页 pairs them up,
   * leaving the last page alone when the document has an odd count.
   */
  const slots = useMemo(
    () => pdfSlots(pageCount, mode.spread),
    [pageCount, mode.spread],
  );

  const viewportMain = horizontal ? viewport.width : viewport.height;
  const slotMain = horizontal
    ? unitMetrics.width * effectiveScale + unitMetrics.gap
    : unitMetrics.height * effectiveScale;
  /**
   * `mandatory` snapping is what makes 翻页 feel like paging — and it is also
   * what would trap a slot that is *larger* than the viewport, since every
   * scroll position inside it is nearer a snap point than the next slot's. So
   * the axis only snaps hard while the current slot fits; a long one falls back
   * to `proximity`, which still pages on a deliberate flick but allows reading
   * it. (The mode is per scroller, so this is measured on the slot in view, the
   * same way the fit modes are.)
   */
  const snapType = !paged
    ? undefined
    : `${axis} ${slotMain <= viewportMain ? "mandatory" : "proximity"}`;

  if (status === "loading") {
    return (
      <div
        data-pdf-viewer
        className={cn(
          "relative flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border bg-muted/30",
          className,
        )}
      >
        {/*
          The cover is the first screen. pdf.js can spend seconds opening a
          perfectly ordinary scan before it has a page to paint (see `coverUrl`
          on `PdfViewerProps`), and this image is already on the API origin, so
          the reader sees page 1 while the parser works instead of an empty
          spinner. `object-contain` because the cover and the viewport rarely
          share an aspect; the scrim keeps the progress row readable on a busy
          page.
        */}
        {coverUrl && (
          <img
            src={coverUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 size-full object-contain p-3"
          />
        )}
        <div className="relative z-10 flex flex-col items-center gap-3 rounded-lg bg-background/85 px-4 py-3 backdrop-blur-sm">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {t("正在加载 PDF")}{" "}
            {progress !== null ? ` · ${Math.round(progress * 100)}%` : "…"}
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        data-pdf-viewer
        className={cn(
          "relative flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border bg-muted/30 px-6 text-center",
          className,
        )}
      >
        <CircleAlert className="size-6 text-muted-foreground" />
        <p className="text-sm text-foreground">
          {failure?.message ?? t("PDF 加载失败。")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("已停止自绘渲染，宿主可以回退到浏览器内置预览。")}{" "}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-pdf-viewer
      onKeyDown={handleKeyDown}
      className={cn(
        "relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border bg-background",
        className,
      )}
    >
      <PdfToolbar
        page={page}
        pageCount={pageCount}
        onPageChange={goToPage}
        zoom={{
          scale: effectiveScale,
          fit,
          onZoomIn: zoomIn,
          onZoomOut: zoomOut,
          onSelectScale: applyZoom,
          onSelectFit: applyFit,
        }}
        mode={mode}
        onModeChange={setMode}
        search={{
          open: search.open,
          query: search.query,
          caseSensitive: search.caseSensitive,
          wholeWord: search.wholeWord,
          count: search.matches.length,
          active: search.activePosition,
          pending: search.pending,
          onOpenChange: search.setOpen,
          onQueryChange: search.setQuery,
          onCaseSensitiveChange: search.setCaseSensitive,
          onWholeWordChange: search.setWholeWord,
          onPrev: search.prev,
          onNext: search.next,
        }}
        sidebar={{ tab: sidebarTab, onTabChange: setSidebarTab }}
        downloadUrl={url}
        onDownload={handleDownload}
        title={title}
        extras={toolbarExtras}
      />

      <div className="flex min-h-0 flex-1">
        {sidebarTab && (
          <PdfSidebar
            tab={sidebarTab}
            page={page}
            pageCount={pageCount}
            spread={mode.spread}
            metrics={metrics}
            getPage={getPage}
            outline={outline}
            onSelectPage={goToPage}
            onTabChange={setSidebarTab}
            onClose={() => setSidebarTab(null)}
          />
        )}

        <div className="relative flex min-h-0 min-w-0 flex-1">
          <div
            ref={scrollRef}
            tabIndex={0}
            role="region"
            aria-label={
              title
                ? translate("{value1} 文档", { value1: title })
                : t("PDF 文档")
            }
            onScroll={handleScroll}
            data-pdf-scroller
            className={cn(
              "relative flex min-h-0 min-w-0 flex-1 gap-3 overflow-auto overscroll-contain bg-muted/40 p-3 outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/40",
              horizontal ? "flex-row" : "flex-col",
              paged && "gap-6 p-4",
              navigationPressed && "cursor-grab active:cursor-grabbing",
            )}
            style={{
              scrollSnapType: snapType,
              // One touch controller owns pages and gutters, including bounded
              // momentum. Browser page zoom must not compete with document pinch.
              touchAction: "none",
            }}
          >
            {slots.map((slot) => {
              const render = visibleSlots.has(slot.index);
              return (
                <div
                  key={slot.index}
                  ref={slotRef(slot.index)}
                  data-pdf-slot={slot.index}
                  className={cn(
                    // The slot is a plain flex box; **centring lives on the row
                    // below as `m-auto`**, never as `justify-center` /
                    // `items-center` here.
                    //
                    // `justify-content: center` on an overflowing flex item centres
                    // it around the container's middle, which puts half of the
                    // overflow *before* the scroll origin — and a scroll container
                    // cannot scroll to a negative offset, so that half is
                    // unreachable. That is exactly the bug the reader reported: at a
                    // multiplier that makes the page wider than the viewport, the
                    // page's left edge could not be reached (the right half was
                    // fine, because that overflow extends the scrollable area).
                    // Auto margins are the one centring that degrades correctly:
                    // they take the free space when there is any, and resolve to
                    // zero when there is not, so an oversized page starts at the
                    // slot's leading edge and its overflow runs off the far end.
                    // Both axes have to be safe, which is why the row uses `m-auto`
                    // rather than one of the two alignment properties: the same
                    // thing happens vertically in 水平 mode, where a page taller
                    // than the viewport must be reachable from its first line.
                    "flex shrink-0",
                    horizontal ? undefined : "w-max min-w-full",
                    paged && (horizontal ? "min-w-full" : "min-h-full"),
                  )}
                  style={paged ? { scrollSnapAlign: "center" } : undefined}
                >
                  {/*
                  The slot's inner row carries the 双页 pairing: the pages always
                  sit left page then right page, on both axes — 方向 decides which
                  way the *slots* run, never how a pair is arranged. `items-start`
                  keeps the two tops flush when the pages differ in height, and
                  `m-auto` is what centres the whole row in its slot (see above).
                */}
                  <div
                    className={cn(
                      "m-auto flex flex-row items-start justify-center",
                      // Must agree with SPREAD_GAP — the fit maths subtracts it.
                      slot.pages.length > 1 && "gap-2",
                    )}
                  >
                    {slot.pages.map((number) => (
                      <PdfPage
                        key={number}
                        pageNumber={number}
                        metrics={metrics.get(number) ?? FALLBACK_PAGE}
                        scale={effectiveScale}
                        renderScale={canvasScale}
                        coverUrl={coverUrl}
                        active={render}
                        getPage={getPage}
                        getTextContent={getTextContent}
                        createTextLayer={createTextLayer}
                        matches={search.matchesForPage(number)}
                        activeMatch={
                          search.activeMatch?.page === number
                            ? search.activeMatch
                            : null
                        }
                        onBoxRef={handlePageBox}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/*
            The ink layer, over the scroller rather than in it: its toolbar is
            chrome and has to stay put while the strip scrolls, while its *canvases*
            are portaled into the page boxes (see `getSurfaces`) so the ink moves
            with the page by construction. Read-only when the host has nowhere to
            put the ink — an embedded preview still shows someone else's notes.
          */}
          {Boolean(onAnnotationsChange || annotations?.length) && (
            <AnnotationLayer
              items={annotations}
              onItemsChange={onAnnotationsChange && handleAnnotationsChange}
              suspendMeasurement={effectiveScale !== canvasScale}
              getSurfaces={getSurfaces}
              surfacesKey={surfacesKey}
              onTouchDrawsChange={handleTouchDrawsChange}
              // The layer arbitrates (palm vs pen, the multi-finger taps, closing a
              // stroke when a second finger lands) but never *drives* the viewport:
              // pan and pinch are the scroller's, recognised above.
              arbitrateViewport
              // 批注 / 浏览. Safe here precisely because the viewer's gestures are on
              // the scroller: 浏览 hands each page's pointers back to the text layer
              // so a passage can be selected, and pan/pinch keep working.
              pointerToggle
              defaultPointerEnabled={false}
              onPointerEnabledChange={(enabled) => {
                annotationEnabledRef.current = enabled;
              }}
              onActiveChange={(active) => {
                activeStrokeRef.current = active;
                if (active) inertiaRef.current?.stop();
              }}
              isNavigationGesture={(event) =>
                event.pointerType === "mouse" &&
                (event.button === 1 || navigationPressedRef.current)
              }
              onResetView={resetView}
              compact={compact}
              maxDpr={PDF_MAX_DPR}
              maxPixels={PDF_MAX_PIXELS}
              readOnly={!onAnnotationsChange}
              className="absolute inset-0"
            />
          )}

          {/*
            恢复位置大小 for a mouse: a click is an ink dot (the ink canvas is the
            pointer target), so the desktop half of the gesture cannot be a double
            click any more than it can on an image. It draws nothing at the view the
            document opened at.
          */}
          {!atOpeningView && (
            <PanZoomResetPill onClick={resetView} className="bottom-4" />
          )}
        </div>
      </div>
    </div>
  );
}
