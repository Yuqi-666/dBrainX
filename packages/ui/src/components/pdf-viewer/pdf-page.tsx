// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * One page of the document: canvas, invisible text layer, search highlights.
 *
 * The page box is *sized from the page's own viewport* (`metrics × scale`) and
 * the canvas is painted into exactly that box. Everything else on this element —
 * text spans, highlight rectangles, the future annotation layer — is positioned
 * against it, so the box is the only coordinate space the page exposes.
 *
 * Two multipliers reach this component and they are not the same number. `scale`
 * is what the box is laid out at, and it follows a gesture immediately.
 * `renderScale` is what the canvas bitmap and the text layer were actually built
 * at, which lags while a zoom gesture is streaming: the bitmap is then stretched
 * to fit the box by a CSS transform, and the text layer and the highlight rectangles go
 * invisible, because they are still positioned for the smaller box and cannot be
 * re-laid-out without the very repaint the stretch exists to avoid. The repaint
 * that ends the gesture brings the two multipliers back together.
 *
 * Two details that are easy to get wrong:
 *
 * - **`--scale-factor` must be published on the box.** pdfjs derives every text
 *   span's font size and position from `calc(... * var(--scale-factor))`; with
 *   the variable missing on zoom, spans collapse to their natural size and the
 *   text layer silently stops matching the glyphs underneath. It describes the
 *   text layer, so it tracks `renderScale`, not `scale`.
 * - **Highlights are overlay rectangles, not wrapped spans.** Wrapping the text
 *   layer's own nodes would invalidate every later offset in the same page —
 *   and those offsets are exactly what search computed. `Range.getClientRects`
 *   measures the real substring instead, at any zoom.
 *
 * The canvas is device-pixel-ratio aware: the bitmap is `dpr ×` the box it was
 * painted for, and that ratio is what makes a finished repaint crisp. The ratio
 * itself is `pdfRasterDpr`'s answer rather than the display's (`min(dpr, 2)`), so
 * a page at a big multiplier is painted a little softer instead of into a bitmap
 * no canvas will allocate. Between one repaint and the next, CSS stretches the
 * bitmap to whatever box the multiplier asks for — no second layout pass, at the
 * cost of soft pixels until the repaint lands.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PDFPageProxy } from "pdfjs-dist";

import { Skeleton } from "@workspace/ui/components/ui/skeleton";
import { cn } from "@workspace/ui/lib/utils";

import { runsForRange } from "./pdf-text";
import { pdfPageCover, pdfRasterDpr, pdfZoomIsCrisp } from "./types";
import type { PdfTextSnapshot } from "./use-pdf-document";
import type {
  PdfPageMetrics,
  PdfRenderTask,
  PdfSearchMatch,
  PdfTextLayerInstance,
  PdfTextLayerParams,
} from "./types";

export interface PdfPageProps {
  pageNumber: number;
  metrics: PdfPageMetrics;
  /** Multiplier the box is laid out at — what the reader sees. */
  scale: number;
  /** Multiplier the bitmap and the text layer were rasterised at. */
  renderScale: number;
  /**
   * Host-provided cover of page 1. Only page 1 paints it, and only until its
   * first bitmap lands: it is the page, just too small to read, so it is a better
   * first screen than a pulsing white rectangle while pdf.js fetches the real
   * page's bytes.
   */
  coverUrl?: string;
  /** Mount canvas + text layer; the viewer gates this on the viewport. */
  active: boolean;
  getPage: (page: number) => Promise<PDFPageProxy | null>;
  getTextContent: (page: number) => Promise<PdfTextSnapshot | null>;
  createTextLayer: (params: PdfTextLayerParams) => PdfTextLayerInstance | null;
  /** Search hits on this page, in document order (empty array clears them). */
  matches: readonly PdfSearchMatch[];
  /** The hit the toolbar is on, when it lands on this page. */
  activeMatch: PdfSearchMatch | null;
  /**
   * Reports the page box element (or `null` on detach) so the annotation layer can
   * portal that page's ink *into* it.
   *
   * Reported rather than passed down on purpose: this component is the page's
   * layout owner, and the ink has to be a child of the very element the page
   * bitmap is sized by — which is what makes it scroll, clip and zoom with the
   * page instead of being re-positioned onto it.
   */
  onBoxRef?: (pageNumber: number, element: HTMLDivElement | null) => void;
  className?: string;
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
  active: boolean;
}

/** `Text` node holding a given character offset inside a text span. */
function locateTextOffset(
  root: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode() as Text | null;

  while (node) {
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    node = walker.nextNode() as Text | null;
  }

  return null;
}

export function PdfPage({
  pageNumber,
  metrics,
  scale,
  renderScale,
  coverUrl,
  active,
  getPage,
  getTextContent,
  createTextLayer,
  matches,
  activeMatch,
  onBoxRef,
  className,
}: PdfPageProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const activeRectRef = useRef<HTMLDivElement | null>(null);
  /**
   * Whether this page currently holds a bitmap worth releasing. Without it the
   * off-screen pages would re-run `release()` on every repaint (the paint effect
   * depends on `renderScale`), i.e. three state updates per page per repaint —
   * jank on a document with a few hundred pages.
   */
  const paintedRef = useRef(false);
  /**
   * Whether this mount has ever painted a real bitmap. The cover stands in for
   * page 1 only until then — after the first paint it is a stale, low-resolution
   * copy, so a later release/repaint must fall back to the ordinary skeleton.
   * A ref because the `setStage("ready")` that follows the first paint already
   * commits the render this flag needs to affect.
   */
  const paintedOnceRef = useRef(false);

  const [stage, setStage] = useState<"idle" | "loading" | "ready">("idle");
  const [snapshot, setSnapshot] = useState<PdfTextSnapshot | null>(null);
  const [textDivs, setTextDivs] = useState<HTMLElement[]>([]);
  const [rects, setRects] = useState<HighlightRect[]>([]);
  /**
   * The multiplier the *text layer currently in the DOM* was laid out for, or 0
   * when there is none. The two layers below are positioned in the bitmap's own
   * coordinate space, so they are only valid while this equals `renderScale` —
   * and the repaint commits `renderScale` before the new layer exists, which is
   * exactly the window in which a highlight would be measured against spans that
   * belong to the previous box.
   */
  const [textScale, setTextScale] = useState(0);
  /**
   * The page's own size at scale 1, once it has actually rendered. The viewer's
   * `metrics` are seeded from page 1 for pages it has not measured yet, so a
   * mixed-size document would clip the pages that differ until the measurement
   * lands; taking the size from the render itself makes that window disappear —
   * and keeps the box and the canvas in agreement by construction.
   */
  const [measuredBase, setMeasuredBase] = useState<PdfPageMetrics | null>(null);
  const proxyRef = useRef<PDFPageProxy | null>(null);

  const base = measuredBase ?? metrics;
  const width = base.width * scale;
  const height = base.height * scale;
  /** The page-1 stand-in, or `null` for every other page and every cover-less file. */
  const cover = pdfPageCover(coverUrl, pageNumber);
  /**
   * Either the box has moved past the bitmap (a zoom gesture is streaming, so the
   * canvas is stretched and the two positioned layers have nothing valid to say),
   * or the bitmap has moved past the text layer (a repaint is in flight, and the
   * spans still belong to the previous box). Both windows are the same thing from
   * the reader's point of view: the layers underneath the canvas are not the ones
   * this box describes, so they wait for the repaint that fixes it.
   */
  const awaiting =
    !pdfZoomIsCrisp(scale, renderScale) || textScale !== renderScale;

  const release = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      // Dropping the backing store is what actually frees the bitmap; a 1×1
      // canvas costs nothing and keeps the element in the tree.
      canvas.width = 1;
      canvas.height = 1;
    }
    textLayerRef.current?.replaceChildren();
    // pdfjs keeps a rendered page's decoded images and glyphs until it is told
    // to let them go; without this a document read from end to end holds every
    // page it ever painted. `cleanup()` is a no-op while a render is in flight,
    // and the render above has already been cancelled by the effect cleanup.
    void proxyRef.current?.cleanup();
    proxyRef.current = null;
    setTextDivs([]);
    setSnapshot(null);
    setTextScale(0);
    setStage("idle");
  }, []);

  /**
   * Publish the page box for the ink layer.
   *
   * The box element exists for every page (only the *painting* is gated on
   * `active`), and the reader of this callback decides which pages are worth a
   * canvas — see the viewer's surface list.
   */
  useEffect(() => {
    if (!onBoxRef) return;
    onBoxRef(pageNumber, boxRef.current);
    return () => onBoxRef(pageNumber, null);
  }, [onBoxRef, pageNumber]);

  useEffect(() => {
    if (!active) {
      if (paintedRef.current) {
        paintedRef.current = false;
        release();
      }
      return;
    }
    paintedRef.current = true;
    const canvas = canvasRef.current;
    const textLayerContainer = textLayerRef.current;
    if (!canvas || !textLayerContainer) return;

    let cancelled = false;
    let renderTask: PdfRenderTask | null = null;
    let textLayer: PdfTextLayerInstance | null = null;

    // A re-render (zoom, DPR change) must not throw the skeleton back over a
    // page that is already painted: only the first paint of a mount waits.
    setStage((current) => (current === "ready" ? current : "loading"));

    /**
     * Forget the spans and the box they were laid out for, together. `textScale`
     * is what marks the layer's coordinate space, so a layer that is not there
     * still has to announce itself as describing the *current* box — otherwise
     * `awaiting` would keep a page's text and highlights hidden for the rest of
     * the session after one failed text fetch.
     */
    const dropTextLayer = () => {
      textLayerContainer.replaceChildren();
      setTextDivs([]);
      setSnapshot(null);
      setTextScale(renderScale);
    };

    const paint = async () => {
      const proxy = await getPage(pageNumber);
      if (cancelled) return;
      if (!proxy) {
        dropTextLayer();
        setStage("ready");
        return;
      }

      const viewport = proxy.getViewport({ scale: renderScale });
      proxyRef.current = proxy;
      setMeasuredBase({
        width: viewport.width / renderScale,
        height: viewport.height / renderScale,
      });
      const dpr = pdfRasterDpr(
        window.devicePixelRatio || 1,
        viewport.width,
        viewport.height,
      );
      const buffer = document.createElement("canvas");
      buffer.width = Math.max(1, Math.floor(viewport.width * dpr));
      buffer.height = Math.max(1, Math.floor(viewport.height * dpr));
      // No inline width/height: the canvas is stretched to the page box by CSS,
      // which is what lets a zoom gesture repaint later than it re-lays-out.

      /**
       * `alpha: true`, so that a page seen with no bitmap on it is white paper
       * rather than a black rectangle.
       *
       * The state this is really about is `release()`: it drops the store to 1×1 to
       * free it, and on a context created with `alpha: false` that 1×1 is **opaque
       * black** — stretched over the whole page by `h-full w-full`, for as long as
       * the reader is looking at it. That window is not hypothetical: a fast pan can
       * put a page on screen before the `IntersectionObserver` has re-activated it,
       * and at a large multiplier the repaint that follows is slow enough to watch.
       * Transparent, the same store leaves the page box's own `bg-white` showing,
       * which reads as a page still sharpening.
       *
       * (A canvas with *no* context is transparent whatever `alpha` was asked for,
       * and the resize→context→fill below is a single synchronous task — so neither
       * a fresh canvas nor a just-resized one was ever the black frame. Only a wipe
       * that outlives the paint was, i.e. `release()`.)
       */
      const context = buffer.getContext("2d", { alpha: true });
      if (!context) {
        // A refusal, not an exception: the canvas is already at the size that was
        // asked of it and there is no white to fill in, because there is no context
        // — the page box's white shows through instead, and the page is marked ready
        // with nothing on it. The pixel budget is what keeps this unreachable; if it
        // ever happens, what the reader sees is a page that stays blank.
        dropTextLayer();
        setStage("ready");
        return;
      }
      // Kept even though pdfjs fills the page background itself (`background` defaults
      // to white): this is what makes the bitmap white *before* the worker's first
      // draw, and it keeps the *bitmap* paper-coloured even if the page box stops
      // being.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, buffer.width, buffer.height);

      renderTask = proxy.render({
        canvasContext: context,
        viewport,
        intent: "display",
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      await renderTask.promise;
      if (cancelled) return;

      canvas.width = buffer.width;
      canvas.height = buffer.height;
      canvas.getContext("2d")?.drawImage(buffer, 0, 0);
      paintedOnceRef.current = true;
      setStage("ready");

      const next = await getTextContent(pageNumber);
      if (cancelled) return;
      if (!next) {
        dropTextLayer();
        setStage("ready");
        return;
      }

      textLayerContainer.replaceChildren();
      // The span list belongs to the layer that was just discarded; clearing it
      // here is what tells the measurement effect to drop its rectangles
      // instead of measuring detached nodes.
      setTextDivs([]);
      textLayer = createTextLayer({
        textContentSource: next.content,
        container: textLayerContainer,
        viewport,
      });
      if (!textLayer) return;
      await textLayer.render();
      if (cancelled) {
        textLayer.cancel();
        return;
      }

      setSnapshot(next);
      setTextDivs(textLayer.textDivs);
      // Published together with the spans: this is what tells the measurement
      // effect that the layer in the DOM now describes `renderScale`.
      setTextScale(renderScale);
      setStage("ready");
    };

    void paint().catch((error: unknown) => {
      // `cancel()` rejects in-flight work with an AbortException; an unmount or
      // a zoom step is not an error worth surfacing.
      if (
        cancelled ||
        (error as { name?: string })?.name === "AbortException"
      ) {
        return;
      }
      setStage("ready");
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [
    active,
    pageNumber,
    renderScale,
    getPage,
    getTextContent,
    createTextLayer,
    release,
  ]);

  /**
   * Measure every match on this page into rectangles inside the page box.
   *
   * A *layout* effect, not a passive one: the repaint that rebuilds the text layer
   * commits the new spans before this measures them, and between that commit and
   * the new rectangles the overlay would otherwise be painted once with the
   * rectangles of the box the page came from. Measuring in the layout phase means
   * the replacement lands in the same frame.
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    // Measuring against a stretched box, or against spans laid out for the box
    // before it, would produce rectangles for geometry that is not on screen.
    // Both layers are hidden in that window, and both conditions are dependencies
    // here, so the repaint that ends it re-runs this effect.
    if (
      !box ||
      !pdfZoomIsCrisp(scale, renderScale) ||
      textScale !== renderScale
    ) {
      return;
    }
    if (!snapshot || !textDivs.length || !matches.length) {
      setRects((previous) => (previous.length ? [] : previous));
      return;
    }

    const boxRect = box.getBoundingClientRect();
    const next: HighlightRect[] = [];

    for (const match of matches) {
      const isActive =
        activeMatch !== null &&
        activeMatch.index === match.index &&
        activeMatch.length === match.length;

      for (const run of runsForRange(snapshot.map, match.index, match.length)) {
        const div = textDivs[run.item];
        if (!div) continue;

        const start = locateTextOffset(div, run.start);
        const end = locateTextOffset(div, run.end);
        let measured: DOMRect[];

        if (start && end) {
          const range = document.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          measured = Array.from(range.getClientRects());
        } else {
          measured = [div.getBoundingClientRect()];
        }

        for (const rect of measured) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          next.push({
            left: rect.left - boxRect.left,
            top: rect.top - boxRect.top,
            width: rect.width,
            height: rect.height,
            active: isActive,
          });
        }
      }
    }

    setRects(next);
  }, [matches, activeMatch, snapshot, textDivs, scale, renderScale, textScale]);

  /**
   * Pull the current hit into view with the smallest possible movement. The
   * viewer already scrolls the *page* into view when the hit changes; this only
   * refines within a page that is taller than the viewport, so it never fights
   * that scroll.
   */
  useEffect(() => {
    if (!activeMatch || !active) return;
    activeRectRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeMatch, active, rects]);

  const boxStyle = useMemo(
    () =>
      ({
        width: `${width}px`,
        height: `${height}px`,
        // pdfjs turns this into every span's font size and position, so it has to
        // describe the text layer that exists — the painted one, not the box.
        "--scale-factor": renderScale,
      }) as CSSProperties,
    [width, height, renderScale],
  );

  /** The scroll anchor: the first rectangle of the current hit. */
  const activeRectIndex = useMemo(
    () => rects.findIndex((rect) => rect.active),
    [rects],
  );

  return (
    <div
      ref={boxRef}
      data-pdf-page-box={pageNumber}
      className={cn(
        // A page is white paper regardless of the theme, so its hairline is a
        // fixed black rather than a theme token (which is white in the dark
        // theme and would vanish on white).
        "relative shrink-0 overflow-hidden bg-white shadow-sm ring-1 ring-black/10",
        className,
      )}
      style={boxStyle}
    >
      {/*
        The bitmap keeps its raster dimensions and follows the box through a
        CSS transform. The scroll geometry changes immediately; pdfjs paints
        once the gesture settles rather than once per input event.
      */}
      <canvas
        ref={canvasRef}
        className="absolute left-0 top-0 block origin-top-left"
        style={{
          // Keep the bitmap's CSS size stable throughout a gesture. Changing
          // width/height each frame repaints it; transform can reuse the same
          // composited texture while the outer box owns scroll geometry.
          width: base.width * renderScale,
          height: base.height * renderScale,
          transform: `scale(${scale / renderScale})`,
          willChange: active && scale !== renderScale ? "transform" : undefined,
        }}
      />

      {rects.length > 0 && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-0",
            // Measured in the bitmap's coordinate space, which the box has left
            // (a gesture) or is about to leave (a repaint) — see `awaiting`.
            awaiting && "invisible",
          )}
        >
          {rects.map((rect, index) => (
            <div
              key={`${rect.left}-${rect.top}-${index}`}
              ref={index === activeRectIndex ? activeRectRef : undefined}
              className={cn(
                // Highlight colours mirror pdfjs's own amber/green pair, on the
                // same white paper the theme cannot tint — so they are fixed
                // values rather than theme tokens.
                "absolute rounded-[2px]",
                rect.active
                  ? "bg-orange-400/60 ring-1 ring-orange-500/70"
                  : "bg-yellow-300/45",
              )}
              style={{
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              }}
            />
          ))}
        </div>
      )}

      {/*
        Belt and braces on the text layer: its stylesheet is a separate chunk, so
        for the frame between the spans being appended and that chunk applying,
        the spans would otherwise inherit the page's text colour and paint a
        second, blurry copy of the page over the canvas. `color` is inherited, so
        setting it on the container is enough — and it agrees with the stylesheet.

        `invisible` whenever these spans do not describe the box on screen — a
        gesture's stretch, or the window while a repaint rebuilds them. They are
        positioned in the bitmap's coordinate space, so until then they would
        select the wrong glyphs and mis-place the highlights measured from them.
      */}
      <div
        ref={textLayerRef}
        className={cn("pdf-viewer-text-layer", awaiting && "invisible")}
        data-pdf-text-layer={pageNumber}
        style={{ color: "transparent" }}
      />

      {stage !== "ready" && (
        /*
          A page is white paper in **either** theme, so its placeholder has to be
          paper too. `Skeleton`'s own `bg-muted` is dark in the dark theme, and a
          dark, pulsing rectangle over a white page is what "loading" looked like
          there — trivially read as a *black page fading in and out*, which is how
          one reader reported the (slow) repaint at a large multiplier. A fixed
          light tint on the same white reads as a page still sharpening instead.

          Page 1 instead shows the upload-time cover, which is the same page at a
          readable size: it is what makes the node's first screen appear before
          pdf.js has finished opening the document. After the first real paint it
          is stale, so the skeleton takes over again (see `paintedOnceRef`).
        */
        <div className="absolute inset-0 flex items-center justify-center bg-white">
          {cover && !paintedOnceRef.current ? (
            <img
              src={cover}
              alt=""
              aria-hidden="true"
              className="size-full object-contain"
            />
          ) : (
            <Skeleton className="size-full rounded-none bg-black/5" />
          )}
        </div>
      )}
    </div>
  );
}
