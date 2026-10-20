// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The ink layer — L1 in design §1.2 and the layer's **only pointer target**.
 *
 * ## What this file owns
 *
 * Pixels, and nothing else. `use-annotation-input.ts` decides *when* a stroke
 * starts and ends; this file decides what is on screen:
 *
 * - **two canvases, one visible.** `committed` is an offscreen
 *   (`document.createElement("canvas")`) replay of `items`; `live` is the
 *   element on screen. Every frame is `clearRect` → `drawImage(committed)` →
 *   the stroke in flight (design §3.2). Replaying finished marks every frame is
 *   pure waste, and the offscreen cache is what removes it.
 * - **the coordinate chain** (design §3.4). `box` (container-relative) places
 *   the element; `rect` (viewport) is what `draw.ts` uses to turn normalized
 *   storage into pixels. **The canvas is exactly as large as the base
 *   rectangle**, so the context origin *is* the rectangle's top-left and there
 *   is no letterbox offset to apply inside it: nothing here ever reads
 *   `rect.left/top`, and the committed cache is blitted 1:1 at `(0, 0)`. The
 *   viewport origin lives in `style.left/top`, which is why it must not be
 *   subtracted again.
 * - **dpr** (design §0.3-6): the backing store is `box.size × dpr` while the CSS
 *   box stays `box.size`, and *both* canvases get the same
 *   `Math.max(1, devicePixelRatio ?? 1)` — the repository's rule from
 *   `packages/graph/src/force/ForceGraph.tsx`. A different dpr on the offscreen
 *   cache would composite at the wrong scale. Moving the window to a screen with
 *   another density (or zooming the browser) changes the ratio *without* a
 *   re-render, so a watcher below turns it into state and rebuilds both stores.
 * - **colour tokens** (design §2.3): an item stores `"red"`, never an
 *   `oklch(…)`. The resolution is a DOM question, so it happens here, once per
 *   replay, by parking `var(--annotation-N)` on a hidden span and reading the
 *   computed colour back.
 * - **`hidden`** (design §1.2 / §2.1): "隐藏批注" is a *visibility* concern — the
 *   data is not touched by a single byte. It stops the ink being **painted**
 *   (the cache is emptied and the stroke in flight is skipped) but leaves the
 *   element hit-testable: since the canvas is also the host's gesture surface,
 *   making it `pointer-events: none` would take pan/zoom away from "let me look
 *   at the original".
 *
 * ## The one rule this file must not break
 *
 * Nothing that a pointer callback can reach may call `setState`, serialise or
 * touch a store (design §3.2/§4.4). The points of the stroke in flight and the
 * ids the eraser just removed live in {@link GestureHandle} — a ref — and the
 * pointer handlers only push and ask for a frame; the one exception is the
 * eraser's *hit* (`onGestureChange`), which is a discrete event rather than a
 * sample and paints on the spot rather than waiting a frame for a ghost to show.
 * It writes pixels, nothing else.
 *
 * ## One canvas per surface, and no dirty rectangles
 *
 * The image host gets one canvas covering the whole layer root; a paginated host
 * (pdf) gets one canvas per page, portaled into the page box (`selfMeasured`) so
 * it scrolls and zooms with the paper. Dirty rectangles are still deferred (design
 * §3.2 defers them until a measurement says the full-frame blit is too slow) —
 * what *is* bounded is the raster's size, through the host's `maxPixels`.
 *
 * The **viewport** is not this file's either: pan / pinch / 恢复位置大小 (单指双击)
 * are recognised by `use-annotation-input.ts` but *owned* by the host, which hands
 * in a `PanZoomController`. This canvas therefore never reads a transform — it
 * only reports gestures, exactly as it reports strokes. Its own geometry stays
 * whatever `box`/`rect` the layer measured, which is the rectangle the host
 * derived from that same transform; that is the whole overlap guarantee.
 *
 * There is deliberately **no `onDoubleClick`** here any more. 恢复位置大小 is a
 * single-finger double *tap* (the mouse half is the host's
 * `pan-zoom/reset-button.tsx`), because a mouse click is ink: a `dblclick`
 * listener would have to suppress the first click's dot, and "click once, get a
 * dot" is worth more than a desktop gesture the button already covers.
 */
import { createBrushAnnotation } from "./brushes";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Annotation, AnnotationPoint } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";

import { annotationPaletteHex } from "./colors";
import { drawAnnotation, drawAnnotations } from "./draw";
import { normalizePoint } from "./geometry";
import {
  ANNOTATION_COLORS,
  type AnnotationCanvasProps,
  type BaseRect,
} from "./types";
import { useAnnotationInput, type GestureHandle } from "./use-annotation-input";

/** `var(--annotation-N)` → the key that maps onto it, built once from the tokens. */
const KEY_TO_CSS_VAR = new Map<string, string>(
  ANNOTATION_COLORS.map((spec) => [spec.key, spec.cssVar]),
);

/**
 * `Math.max(1, devicePixelRatio ?? 1)` — the repository's dpr rule (§0.3-6).
 *
 * Deliberately **uncapped**: this is what the state below tracks and what the media
 * query is pinned to. The host's cap ({@link AnnotationCanvasProps.maxDpr}) is
 * applied on top of the state instead, because a query pinned to a *capped* ratio
 * can never fire: on a 2.5× display with a 2× cap the query `(resolution: 2dppx)`
 * is false from the start and stays false when the display changes, so the backing
 * store would keep its 2× size while the drawing transform moved to 1.5×.
 */
function readDpr(): number {
  return Math.max(1, globalThis.devicePixelRatio ?? 1);
}

/**
 * `pointerType === "pen"` reports real pressure; a mouse reports a constant
 * `0.5` and a pressure-less touchscreen `0` or `1` (design §4.5). All of them
 * are sampled verbatim — `shouldSimulatePressure` decides at release whether the
 * numbers meant anything.
 */
function toPressure(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value > 1 ? 1 : value;
}

function hasSize(rect: { width: number; height: number }): boolean {
  return (
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * A live 2D context is not guaranteed: a canvas larger than the browser's limit
 * silently yields `null`. Returning `null` keeps every call site honest instead
 * of asserting.
 */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext("2d");
}

export function AnnotationCanvas({
  isNavigationGesture,
  box,
  canvas: canvasBox,
  rect,
  selfMeasured = false,
  rasterScale = 1,
  maxDpr,
  maxPixels,
  items,
  tool,
  eraserMode = "stroke",
  size,
  color,
  touchDraws = false,
  hidden = false,
  readOnly = false,
  panZoom,
  arbitrateViewport = false,
  pointerEnabled = true,
  onUndo,
  onRedo,
  onOperation,
  onActiveChange,
}: AnnotationCanvasProps) {
  const { t } = useI18n();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const committedRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  /**
   * The rectangle the gesture in flight is normalized against, for a
   * **self-measured** canvas only (see {@link AnnotationCanvasProps.selfMeasured}).
   *
   * Written once, on the first pointer of a gesture, and dropped when the gesture
   * ends — never per sample: a `getBoundingClientRect()` in a pointer callback is a
   * forced layout, and the sample rate is the one place in this file that must not
   * pay for one.
   */
  const gestureRectRef = useRef<BaseRect | null>(null);

  /**
   * The one gesture that can be in flight, allocated once so its identity is
   * stable across renders (the state machine and the renderer both hold it).
   */
  const gestureRef = useRef<GestureHandle>({
    points: [],
    erasedIds: new Set<string>(),
    replacements: new Map(),
    tick: 0,
    active: false,
    pointerId: -1,
  });
  const gesture = gestureRef.current;

  /** The items the eraser hit-tests against — a prop mirror, written in render. */
  const itemsRef = useRef<Annotation[]>(items);
  itemsRef.current = items;

  /**
   * Values the render callback reads. A frame can be requested from an input
   * callback that outlives the render that created it, so the colours and the
   * nib have to come from a ref rather than from a closure.
   */
  const styleRef = useRef({ tool, size, color });
  styleRef.current = { tool, size, color };

  /** A resolved token colour is worth caching: the token set is fixed. */
  const colorCacheRef = useRef(new Map<string, string>());

  /**
   * `devicePixelRatio` as **state**.
   *
   * Reading it during render (as the rest of the repository does) is not enough
   * here: moving the window to a screen with a different density, or zooming the
   * browser, changes the ratio without changing a single prop — nothing would
   * re-render, so the backing stores would keep their old size and the ink would
   * come out blurry (design §0.3-6). A media query pinned to the current ratio
   * fires exactly when it stops matching, and the state update re-runs the
   * sizing/rebuild effects.
   */
  const [deviceDpr, setDeviceDpr] = useState(readDpr);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(resolution: ${deviceDpr}dppx)`);
    const onChange = () => setDeviceDpr(readDpr());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [deviceDpr]);

  /**
   * The ratio the ink is rasterised at: the display's, capped by the host's ratio
   * ({@link AnnotationCanvasProps.maxDpr}) and then by its **pixel budget**
   * ({@link AnnotationCanvasProps.maxPixels}).
   *
   * One value, read by the sizing effect, the replay *and* the frame — a store
   * sized at one density and drawn at another is the blurry/stretched ink §0.3-6
   * exists to prevent, which is exactly what two independent reads would risk.
   *
   * The budget is the same back-off `pdfRasterDpr` applies to a page bitmap, for
   * the ink painted on it: the host has said how many device pixels one surface may
   * cost, and the density that fits is `sqrt(budget / area)` — the cap cancels out,
   * which is why this is one square root rather than a ratio. A host that passes a
   * meaningless budget gets the display's density rather than a vanished canvas.
   */
  const cappedDpr =
    (maxDpr === undefined ? deviceDpr : Math.min(deviceDpr, maxDpr)) *
    rasterScale;
  const dpr =
    maxPixels === undefined || !(maxPixels > 0)
      ? cappedDpr
      : Math.min(
          cappedDpr,
          Math.sqrt(
            maxPixels / Math.max(1, canvasBox.width * canvasBox.height),
          ),
        );

  /**
   * The geometry a frame draws with, **read at frame time**.
   *
   * A frame can be requested by a pointer sample and run on the next animation
   * frame, so by the time it runs the props may have moved on — a zoom step
   * resizes the element, a display change rewrites the ratio. `requestFrame`
   * coalesces, so the pending callback *is* the previous render's closure; closing
   * over `box`/`rect`/`dpr` would have it clear and blit at the old size (garbage
   * at the edges of a grown store, ink at the wrong scale) and nothing would ask
   * again until the next sample. The geometry-driven paints do not go through a
   * request at all any more (see the sizing effect), which is one more reason the
   * values have to come from a ref: they are read by a callback that was created
   * by the render *before* the one that changed them.
   */
  const geometryRef = useRef({ box, rect, canvas: canvasBox, dpr, hidden });
  geometryRef.current = { box, rect, canvas: canvasBox, dpr, hidden };

  /**
   * Resolve one stored colour key to a CSS colour that is correct **in the
   * current theme**.
   *
   * The span is parked on the canvas element (which has no children of its own)
   * and removed immediately; every replay re-reads the six tokens because a
   * theme switch changes what `var(--annotation-1)` means, and the cache is
   * dropped in that case.
   */
  const resolveColor = useCallback((key: string): string => {
    const paletteColor = annotationPaletteHex(key);
    if (paletteColor) return paletteColor;
    const cached = colorCacheRef.current.get(key);
    if (cached) return cached;

    const cssVar = KEY_TO_CSS_VAR.get(key);
    const canvas = canvasRef.current;
    let resolved = cssVar ?? "";
    if (cssVar && canvas && typeof getComputedStyle === "function") {
      const probe = document.createElement("span");
      probe.style.color = `var(${cssVar})`;
      probe.style.display = "none";
      canvas.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      if (computed) resolved = computed;
    }
    if (resolved) colorCacheRef.current.set(key, resolved);
    return resolved;
  }, []);

  // ---- The frame ---------------------------------------------------------

  /**
   * One frame: the cached marks, then the mark in flight.
   *
   * Reached two ways, and the difference matters to whoever reads this next:
   * through `requestFrame` for a burst of pointer samples, which coalesces them to
   * one paint per frame, and through `paintNow` for the geometry-driven paints (a
   * resize, a replay), which must land in the paint the commit they belong to is
   * about to produce. A synchronous caller therefore cancels the requested frame
   * rather than leaving it to repeat the same work.
   */
  const renderFrame = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const committed = committedRef.current;
    if (!canvas || !committed) return;

    const ctx = context2d(canvas);
    if (!ctx) return;

    const {
      box: frameBox,
      rect: frameRect,
      canvas: frameCanvas,
      dpr: currentDpr,
      hidden: frameHidden,
    } = geometryRef.current;
    const inside = gesture;
    const {
      tool: activeTool,
      size: activeSize,
      color: activeColor,
    } = styleRef.current;

    // The canvas element covers the whole layer root (`style.left/top/width/
    // height` below), so `box` is *inside* it: translate to the base rectangle's
    // origin and every coordinate from here on is in the rectangle's own CSS
    // pixel space — the convention `draw.ts` is written against.
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    ctx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);

    if (hasSize(frameRect) && hasSize(frameBox) && committed.width > 0) {
      // 1:1: the cache has the canvas's dimensions too, so there is nothing to
      // letterbox — just the same translation the ink below uses.
      ctx.drawImage(committed, 0, 0, frameCanvas.width, frameCanvas.height);
    }

    if (
      !frameHidden &&
      activeTool !== "eraser" &&
      activeTool !== "pointer" &&
      inside.points.length > 0 &&
      hasSize(frameRect)
    ) {
      // The in-flight stroke goes through the same renderer as the stored ones —
      // the normalized input becomes a display-space item here and nowhere else,
      // so a stroke cannot change shape the moment it is committed.
      const live = createBrushAnnotation(
        activeTool,
        inside.points,
        activeSize,
        activeColor,
        document.documentElement.classList.contains("dark"),
      );
      ctx.save();
      ctx.translate(frameBox.left, frameBox.top);
      drawAnnotation(ctx, live, frameRect, resolveColor);
      ctx.restore();
    }
    // Only the things that cannot change between the request and the frame: the
    // geometry and the density come from `geometryRef` (see above).
  }, [gesture, resolveColor]);

  /** Request a frame; a request already outstanding is not queued twice. */
  const requestFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(renderFrame);
  }, [renderFrame]);

  /**
   * Paint the visible canvas **now**, cancelling a frame that was asked for.
   *
   * The counterpart of `requestFrame` for the two paths that cannot wait a frame:
   * a resize (which clears the element) and the eraser's discrete hit. Cancelling
   * first is not tidiness — `renderFrame` drops the id it was scheduled under, so a
   * stale request would otherwise survive and paint the same pixels a second time.
   */
  const paintNow = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    renderFrame();
  }, [renderFrame]);

  // ---- Sizing, dpr and the committed cache -------------------------------

  /**
   * `floor`, not `round`: the density above is chosen so the *continuous* area is
   * exactly `maxPixels`, and rounding both dimensions up would overshoot it (a
   * Letter page at 6× by ~3k pixels — enough to matter on a browser whose canvas
   * cap is exactly 4096²). The page bitmap floors for the same reason, so paper and
   * ink keep the same answer. The cost is a store up to one device pixel smaller
   * than the box, i.e. a scale of 1 − 1/3000 that the compositor applies anyway.
   */
  const outsideWidth = Math.max(1, Math.floor(canvasBox.width * dpr));
  const outsideHeight = Math.max(1, Math.floor(canvasBox.height * dpr));

  /**
   * Size both backing stores and place the element.
   *
   * A single-surface canvas (an image) covers the whole layer root
   * (`left: 0 / top: 0`), **not** just the base rectangle: the extra area is where
   * a finger lands when it pinches beside a letterboxed photo, and it costs
   * nothing because the ink is clipped by the same box the canvas is. `canvasBox`
   * is layout pixels, `outsideWidth/Height` the device-pixel store — setting only
   * the CSS box is the classic blurry-ink bug (design §0.3-6). Re-running on a dpr
   * change is what rebuilds the cache.
   *
   * A **self-measured** canvas is pinned to its page box instead of being given the
   * layer's own box: it writes `left/top/right/bottom: 0` plus an explicit
   * `100%` × `100%` (see the branch below for why `auto` is a trap on a replaced
   * element). The bitmap is then scaled into the page box by the browser, which is
   * the same contract the page's own bitmap has, and it makes the two multipliers
   * independent: the box is what the page is laid out at, the store is what the ink
   * was rasterised at, and a density the budget has reduced reads as soft ink
   * rather than as a canvas that covers only part of its page.
   *
   * ## A layout effect, and why the whole paint has to happen here
   *
   * A pinned canvas is the case that made this a layout effect. Its box is the page
   * box, so it moves in the commit that moves the page — while a *passive* effect
   * would resize the backing store after the browser had already painted it, i.e.
   * one frame of resampling per zoom step, the ink shimmering against the page it
   * sits on. (That was the reported "字迹一直在抖动": the page bitmap is allowed to
   * lag and be stretched on purpose, but the ink is not — it is the thing being
   * read at 1:1.) Resizing before the paint is only half of it: the resize *clears*
   * the canvas, so the refill has to land in the same paint too, which is why the
   * replay effect below blits synchronously instead of asking for a frame. The
   * image host needs the same thing for a different reason: there the element's own
   * `style` is what moves it, so a passive write left the ink a frame behind the
   * photo.
   *
   * ## Why there is no "only re-rasterise when the box moved by more than 2%" here
   *
   * The pdf's page bitmap has exactly that policy (`pdfZoomRaster`: stretch now,
   * repaint when the gesture stops) and the ink deliberately does not, even though
   * a per-step replay is the most expensive thing in this file: the stroke in
   * flight is drawn into the *same* store as the committed ink, from the latest
   * geometry. A store that lagged its box would have to draw those live points in
   * the lagging space and scale them back, and every committed mark would be drawn
   * at a scale the store no longer had — the replacement for a frame of soft ink
   * would be ink that does not sit where the pen went. What keeps the per-step
   * replay affordable is the host's `maxPixels` budget, not a tolerance.
   */
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (selfMeasured) {
      // **`100%`, not `auto`** — and this is not tidiness, it is the difference
      // between ink on the page and ink magnified off it.
      //
      // A `<canvas>` is a *replaced* element, so an absolutely positioned one whose
      // width is `auto` takes that width from **its own bitmap** (the `width`
      // attribute, in CSS px), not from the box its insets are pinned to: CSS 2.2
      // §10.3.8 resolves an abs-positioned replaced element's `auto` width from its
      // intrinsic size and then ignores the over-constrained `right`. Leaving
      // `width`/`height` unset here therefore made the store *be* the element's CSS
      // box: on a dpr-2 display the canvas laid out at twice the page, so the ink
      // was drawn at 1 bitmap px per CSS px — twice the intended scale, clipped by
      // the page, with normalised storage compressed by the same factor — and a
      // budget-driven density below 1 (see `maxPixels`) would have shrunk the
      // *element*, leaving the rest of the page with no pointer target at all.
      //
      // With an explicit 100% the element is the page box and the bitmap is scaled
      // into it, exactly as the page's own bitmap is (`h-full w-full` in
      // `pdf-page.tsx`). That is what makes a reduced density read as *softer* and
      // never as *smaller*, and it keeps `measureSelf()` (the canvas) and `rect`
      // (the layer's measurement of the same page box) describing one rectangle.
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.right = "0px";
      canvas.style.bottom = "0px";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    } else {
      canvas.style.right = "";
      canvas.style.bottom = "";
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.width = `${canvasBox.width}px`;
      canvas.style.height = `${canvasBox.height}px`;
    }

    if (canvas.width !== outsideWidth) canvas.width = outsideWidth;
    if (canvas.height !== outsideHeight) canvas.height = outsideHeight;

    const ctx = context2d(canvas);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The offscreen cache is **not** attached to the DOM; it only has to exist so
    // `drawImage` has a source. A resize or a dpr change invalidates it, so it is
    // rebuilt here and replayed by the effect below.
    const committed = document.createElement("canvas");
    committed.width = outsideWidth;
    committed.height = outsideHeight;
    committedRef.current = committed;
  }, [
    canvasBox.height,
    canvasBox.width,
    dpr,
    outsideWidth,
    outsideHeight,
    selfMeasured,
  ]);

  /**
   * Replay the committed marks into the offscreen cache.
   *
   * Two callers, and they are the two reasons the cache can go stale:
   *
   * 1. the effect below, i.e. a prop changed (the data, the rectangle, the dpr,
   *    the hidden flag);
   * 2. `onGestureChange`, i.e. the eraser just touched a mark. That one is a
   *    *discrete input event*, not a sample, and it must repaint without a render:
   *    a ref cannot re-run an effect, so "the ghost set grew" has to be a direct
   *    call. Replaying once per hit is what the cache is for — replaying per pointer
   *    sample is what it exists to avoid.
   *
   * While `hidden` the cache is left empty, which is what makes hiding cost nothing
   * per frame.
   */
  const replayCommitted = useCallback(() => {
    const committed = committedRef.current;
    if (!committed) return;
    if (!hasSize(rect) || !hasSize(box)) return;

    const ctx = context2d(committed);
    if (!ctx) return;

    // A theme change rewrites the tokens' computed values, so the cache is
    // dropped on every replay: six `getComputedStyle` calls cost far less than
    // the replay itself, and a stale colour is a wrong colour.
    colorCacheRef.current.clear();

    // The *state* ratio, not `readDpr()`: the cache must be written at the same
    // density the sizing effect just gave both stores, and a live read could differ
    // from it for the frame between the screen change and the media query firing.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasBox.width, canvasBox.height);
    if (!hidden) {
      // The translate puts the cache into the base rectangle's own space, which
      // is the convention `draw.ts` is written against (§3.4). Marks the eraser
      // hit are passed along as ghosts: they stay visible at reduced alpha until
      // the layer lands the removal, so the user can see what the pass is about
      // to delete (G5's third report).
      ctx.translate(box.left, box.top);
      drawAnnotations(
        ctx,
        items.flatMap((item) => gesture.replacements.get(item.id) ?? [item]),
        rect,
        resolveColor,
        {
          ghostIds: gesture.erasedIds,
        },
      );
    }

    // And the visible canvas, in the same task. The effect below runs in the
    // layout phase, right after a resize may have cleared the element, so a
    // *requested* frame would leave the blank store on screen for the frame in
    // between — and a scroll or a zoom can make the compositor produce one at any
    // moment. Blitting here is what keeps clear and refill inside one paint.
    paintNow();
  }, [
    box,
    canvasBox.height,
    canvasBox.width,
    dpr,
    gesture,
    hidden,
    items,
    paintNow,
    rect,
    resolveColor,
  ]);

  useLayoutEffect(() => {
    replayCommitted();
  }, [replayCommitted]);

  /** A new `items` array means the parent has landed the last gesture.
   *
   * This is where the eraser's ghost set is released: it was kept alive at release
   * so the deleted marks could not flash back, and it must go as soon as the
   * deletion is real, because an id that no longer exists in `items` has nothing
   * left to fade.
   */
  const lastItemsRef = useRef(items);
  useEffect(() => {
    if (lastItemsRef.current === items) return;
    lastItemsRef.current = items;
    gesture.erasedIds.clear();
    gesture.replacements.clear();
    requestFrame();
  }, [items, gesture, requestFrame]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  // ---- Input -------------------------------------------------------------

  /**
   * The base rectangle pointers are normalized against.
   *
   * The image path reads the host's measurement (`rect`): the base is derived
   * from a transform the host owns, so measuring the `<img>` would put the ink a
   * frame behind the photo. The pdf path measures the canvas element itself,
   * because there the element *is* the page box and its viewport position changes
   * with every scroll — a state-carried `rect` would be stale exactly then.
   */
  const measureSelf = useCallback((): BaseRect | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const measured = canvas.getBoundingClientRect();
    if (measured.width <= 0 || measured.height <= 0) return null;
    return {
      left: measured.left,
      top: measured.top,
      width: measured.width,
      height: measured.height,
    };
  }, []);

  /**
   * The base rectangle test a stroke has to pass to *begin* (the canvas is larger
   * than the base — see {@link AnnotationCanvasProps.canvas}).
   *
   * This is also where a **self-measured** canvas fixes the space for the whole
   * stroke, and for exactly one reason: it is the machine's first call of a
   * gesture (`onPointerDown` → `inBounds` → `onPoint`), so one measurement here
   * covers the stroke and no sample pays for a layout read. Storing it *only* when
   * the point is inside is what keeps a rejected attempt from leaving a rectangle
   * behind for the next one — after a scroll, a cached rectangle is a stroke drawn
   * at the wrong offset.
   */
  const inBounds = useCallback(
    (clientX: number, clientY: number): boolean => {
      const target = selfMeasured ? measureSelf() : rect;
      if (!target) {
        gestureRectRef.current = null;
        return false;
      }
      const inside =
        clientX >= target.left &&
        clientX <= target.left + target.width &&
        clientY >= target.top &&
        clientY <= target.top + target.height;
      gestureRectRef.current = inside ? target : null;
      return inside;
    },
    [measureSelf, rect, selfMeasured],
  );

  const onPoint = useCallback(
    (clientX: number, clientY: number, pressure: number): AnnotationPoint => {
      // `inBounds` has already fixed the space for this gesture; the fallback is
      // only for a sample that somehow arrives without one, and stays in the same
      // space rather than mixing viewport and layout coordinates.
      const target = selfMeasured
        ? (gestureRectRef.current ?? measureSelf())
        : rect;
      const point = target
        ? normalizePoint(target, clientX, clientY)
        : { x: 0, y: 0 };
      const p = toPressure(pressure);
      return p === undefined ? point : { ...point, p };
    },
    [measureSelf, rect, selfMeasured],
  );

  /**
   * Drop the per-gesture measurement when the stroke ends, so the next one is
   * measured against wherever the page is by then.
   */
  const handleActiveChange = useCallback(
    (active: boolean) => {
      if (!active) gestureRectRef.current = null;
      onActiveChange?.(active);
    },
    [onActiveChange],
  );

  // The options object is rebuilt every render on purpose: the hook mirrors the
  // latest one into a ref, so a callback that outlives its render still reads the
  // current tool, nib, colour and 手指=书写 switch. `onGestureChange` is the eraser's
  // discrete signal (a mark was just hit): it replays the cached layer at once,
  // without a render — the hook never calls it for a plain pen sample.
  const input = useAnnotationInput({
    isNavigationGesture,
    gesture: gestureRef,
    tool,
    eraserMode,
    size,
    color,
    touchDraws,
    hidden,
    readOnly,
    itemsRef,
    onPoint,
    inBounds,
    onOperation,
    onActiveChange: handleActiveChange,
    requestFrame,
    onGestureChange: replayCommitted,
    // The host's viewport (image / pdf). `panEnabled` is the 手指=书写 contract:
    // while a finger draws, only two or more fingers may pan/zoom — which also
    // means a pinch still works, because the second finger closes the stroke.
    viewport:
      panZoom || arbitrateViewport
        ? {
            controller: panZoom,
            panEnabled: tool === "pointer" || !touchDraws,
            onUndo,
            onRedo,
          }
        : undefined,
  });

  return (
    <canvas
      ref={canvasRef}
      data-annotation-canvas
      tabIndex={0}
      aria-label={t("批注画布")}
      // `touch-action: none` is written as a style rather than a class for one
      // reason: a class can be purged, and without this the browser claims the
      // pen's moves as a scroll and never delivers them (design §0.3-2). It is
      // also why the canvas — not its parent — is `pointer-events: auto`.
      //
      // `hidden` is "do not paint the ink" — never `display`, never a data change,
      // and deliberately **not** `pointer-events: none`: the element stays the
      // host's gesture surface, so 隐藏批注 can be inspected with pan/zoom (design
      // §2.1's 隐藏批注 row says the data is untouched; the layer header says why
      // the pointers stay).
      //
      // `pointer-events: auto` is **load-bearing**, not decoration: the layer root
      // is `pointer-events: none` and the property is inherited, so a canvas
      // without this line is not hit-testable at all — the whole gesture surface
      // silently disappears.
      style={{
        position: "absolute",
        touchAction: "none",
        // 浏览 mode hands the page's pointers back to what is underneath — on a pdf
        // that is the text layer, so a passage can be selected — while the ink stays
        // painted and the *host's* gestures (which live on its own scroller) keep
        // working. A read-only layer keeps its pointers: it simply refuses to start
        // a stroke, and an image host's pan/zoom (which live *on this element*) must
        // not be taken away by "you may not draw here".
        pointerEvents: pointerEnabled ? "auto" : "none",
        cursor:
          !pointerEnabled || readOnly
            ? "default"
            : tool === "pointer"
              ? "grab"
              : tool === "eraser"
                ? "cell"
                : "crosshair",
      }}
      className={cn("z-10 block select-none")}
      onPointerDown={input.handlers.onPointerDown}
      onPointerMove={input.handlers.onPointerMove}
      onPointerUp={input.handlers.onPointerUp}
      onPointerCancel={input.handlers.onPointerCancel}
      onLostPointerCapture={input.handlers.onLostPointerCapture}
    />
  );
}
