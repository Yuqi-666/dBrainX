// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The ink layer's **pointer state machine** — design §4 in one file.
 *
 * Splitting it out of `annotation-canvas.tsx` follows the plan's §5.1 W2-c
 * boundary: everything in here is input arbitration (which pointer may draw,
 * when a gesture starts and, above all, when it *ends*), while the canvas only
 * owns pixels. The two exchange exactly three things through
 * {@link GestureHandle}: the points sampled so far, the ids erased by the pass
 * in flight, and a "something changed, draw a frame" callback.
 *
 * ## The one rule that must not be broken
 *
 * **An input callback pushes a sample and asks for a frame. It never
 * `setState`s, never serialises and never writes a store** (design §3.2, §4.4).
 * That is what keeps a stroke within one frame of the pen, and it is the only
 * rule a reviewer can check by reading this file — so every mutable piece of an
 * in-flight gesture lives in a ref (`GestureHandle.points`, `activePointers`,
 * `gesture`) and none of it is React state.
 *
 * ## Why the end-of-gesture list has four entries
 *
 * A stroke that is never closed keeps drawing forever (design §0.3-8). `pointerup`
 * is not enough: a browser gesture, a focus trap, a tab switch or dragging the
 * pointer out of the window all end a stroke **without** one. So the machine
 * closes on `pointerup`, `pointercancel`, `lostpointercapture`, and — attached
 * for the component's lifetime with cleanup, because they are not pointer events
 * on the canvas — `visibilitychange → hidden` and `window blur`. All of them are
 * idempotent: a stroke is committed from the points already sampled, never left
 * "in progress".
 *
 * ## Pen vs. touch
 *
 * `pointerType === "pen"` always draws. `touch` draws **only** when the host
 * turns `touchDraws` on, and never while a pen pointer is down — that is the
 * application-level half of palm rejection (design §0.3-5: the specification
 * lets a device ignore touch while a pen is in use, so an app must assume it
 * does not). `mouse` draws, with velocity-simulated pressure, and a mouse click
 * lands a dot exactly like a pen tap.
 *
 * ## Not in P0
 *
 * No hover preview, no `pointerrawupdate` and no `getPredictedEvents()`
 * (design §0.3-4) — the next step there is measured latency, not guesswork.
 *
 * ## Viewport gestures (pan / pinch / taps)
 *
 * The ink canvas is the only element a pointer lands on, so it is also where the
 * *shared* viewport is driven. Every touch that is not drawing is arbitrated here
 * and handed to the host's {@link PanZoomController}; the multi-finger taps go
 * back to the layer, which owns the history:
 *
 * | gesture                    | result                                        |
 * | -------------------------- | --------------------------------------------- |
 * | one finger drag            | pan (`panEnabled`, i.e. 手指=书写 off)         |
 * | two+ fingers pinch / drag  | zoom about the midpoint + pan with it         |
 * | one-finger double tap      | 恢复位置大小 (`controller.reset()`)             |
 * | two-finger tap             | 双指轻点撤回 (`onUndo`)                          |
 * | three-finger tap           | 三指轻点重做 (`onRedo`)                          |
 * | pen, any                   | never a viewport gesture — it draws            |
 *
 * The **mouse** has no entry here, on purpose: its clicks are ink (see
 * `endGesture`), so 恢复位置大小 on a desktop is the host's
 * `pan-zoom/reset-button.tsx`, which needs no recogniser at all.
 *
 * Two invariants are worth stating because they are easy to break:
 *
 * 1. **The pinch is composed from the transform snapshot taken when the gesture
 *    (re)anchored**, not from the previous frame — adding or lifting a finger
 *    re-anchors, which is what makes a 3→2 finger change continue without a jump
 *    (the semantics `packages/graph/src/force/eventListener.ts` established).
 * 2. **A second finger closes the stroke in flight before the pinch starts.** A
 *    finger that lands mid-stroke is a pinch, not a second pen; without the
 *    explicit `endGesture()` the first stroke would keep growing while the view
 *    zoomed under it.
 */
import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Annotation, AnnotationPoint } from "@workspace/interfaces";

import { hitTestItem, simplifyPoints, withBBox } from "./geometry";
import { createBrushAnnotation } from "./brushes";
import { erasePath, eraserSamples } from "./erase";
import {
  centroidOf,
  classifyTapEnd,
  isDoubleTap,
  spreadOf,
  TAP_SLOP,
} from "../pan-zoom/recognizer";
import type {
  ViewportGestureOptions,
  ViewportTransform,
} from "../pan-zoom/types";
import type {
  AnnotationColorKey,
  AnnotationTool,
  EraserMode,
  AnnotationOperation,
} from "./types";

/**
 * The mutable state of one in-flight gesture, shared with the renderer.
 *
 * Everything here is written from a pointer callback, so it must stay out of
 * React state: a re-render per sample is exactly the cost the "push + rAF" rule
 * exists to avoid. The renderer reads it during its own frame, which is the only
 * moment a coherent triples is needed.
 */
export interface GestureHandle {
  /** Already normalized and clamped by the canvas's `onPoint`. */
  readonly points: AnnotationPoint[];
  /**
   * Ids the eraser hit during **this** pass; the renderer fades them.
   *
   * Written by the eraser branch below and cleared by the **renderer** once the
   * `items` prop reflects the removal — never by the state machine at release, or
   * the marks would flash back to full alpha for the frames between the emitted
   * operation and the parent landing it.
   */
  readonly erasedIds: Set<string>;
  readonly replacements: Map<string, Annotation[]>;
  /**
   * Bumped whenever a sample lands.
   *
   * A debugging/`renderFrame` convenience rather than a render trigger: the eraser's
   * discrete repaint goes through `onGestureChange` (see below), because a ref
   * cannot re-run an effect and an effect dependency is only re-read when React
   * renders for some other reason.
   */
  tick: number;
  /** `true` from `pointerdown` until the gesture is committed. */
  active: boolean;
  /**
   * The pointer that opened the gesture.
   *
   * A touch landing while the pen is down, or the pen being lifted while a palm
   * rests on the screen, must not be able to end *someone else's* stroke — the
   * four end paths are all pointer events, and without this every one of them
   * would close whatever happened to be open.
   */
  pointerId: number;
}

/** The three knobs the canvas owns and the state machine only reads. */
export interface AnnotationInputOptions {
  isNavigationGesture?: (event: PointerEvent) => boolean;
  /** The live gesture, allocated once by the canvas via `useRef`. */
  gesture: RefObject<GestureHandle>;
  tool: AnnotationTool;
  eraserMode?: EraserMode;
  /** Nib width in normalized units — also the eraser's reach (`size × 2`). */
  size: number;
  color: AnnotationColorKey;
  /** Design §0.3-5's fallback: when on, a single finger draws like a pen. */
  touchDraws: boolean;
  /** `hidden` means "show nothing, take nothing" — pointerdown is ignored. */
  hidden?: boolean;
  /** `readOnly` means "show it, take nothing" — the host cannot persist a stroke. */
  readOnly?: boolean;
  /** Live items, for the eraser's hit test. Owned by the canvas. */
  itemsRef: RefObject<Annotation[]>;
  /**
   * Viewport CSS px → normalized storage point (`normalizePoint(rect, …)`),
   * carrying the pointer's pressure through untouched.
   */
  onPoint: (
    clientX: number,
    clientY: number,
    pressure: number,
  ) => AnnotationPoint;
  /**
   * Is this viewport point on the base rectangle?
   *
   * A stroke may only **start** on the base. The canvas element covers the whole
   * host (so a pinch can begin on a letterbox), and without this a pen going down
   * beside a letterboxed photo would draw a clamped line along its edge instead
   * of doing nothing. Points sampled *during* a stroke are still clamped, not
   * rejected — a stroke that leaves the image keeps the part that is on it.
   */
  inBounds: (clientX: number, clientY: number) => boolean;
  /** One finished gesture, reported once (design §1.2 boundary 2). */
  onOperation: (operation: AnnotationOperation) => void;
  /** A gesture started / ended — the layer uses it for the cursor and ⌘Z focus. */
  onActiveChange?: (active: boolean) => void;
  /** Ask the canvas for a frame. Called from input callbacks; never mutates. */
  requestFrame: () => void;
  /**
   * The shared viewport, when the host has one. Its presence is what turns the
   * non-drawing touch sequences into pan/pinch/double-tap and the two- and
   * three-finger taps into undo/redo (see the file header). Absent, the canvas
   * behaves exactly as it did before gestures existed: touch never draws and
   * never moves anything.
   */
  viewport?: ViewportGestureOptions;
  /**
   * Called when `gesture` changed in a way a *frame* cannot express — today: the
   * eraser hit at least one new mark, so the cached layer must be replayed with the
   * new ghost set. Never called for an ordinary sample (the live stroke is drawn
   * every frame anyway), so a renderer may do real work here. Must not `setState`
   * — it runs inside a pointer callback.
   */
  onGestureChange?: () => void;
}

/**
 * The DOM handlers the canvas spreads onto its `<canvas>` element.
 *
 * Declared structurally so the hook does not depend on React's synthetic-event
 * generics: the canvas passes `onPointerDown={input.handlers.onPointerDown}`
 * and nothing here needs to know it came from JSX.
 */
export interface AnnotationInputHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
}

export interface AnnotationInput {
  handlers: AnnotationInputHandlers;
}

/** No Web API dependency: `crypto.randomUUID` needs a secure context (§0.3-3). */
function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  let hex = "";
  for (let i = 0; i < 32; i += 1) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * `getCoalescedEvents()` is **not Baseline** and needs a secure context
 * (design §0.3-3) — feature-detect it and fall back to the single delivered
 * point, which is the only correct degradation.
 */
function coalescedPoints(event: PointerEvent): PointerEvent[] {
  if (typeof event.getCoalescedEvents === "function") {
    const coalesced = event.getCoalescedEvents();
    if (coalesced.length > 0) return coalesced;
  }
  return [event];
}

/* ------------------------------------------------------------------ *
 * Viewport gesture recognition
 * ------------------------------------------------------------------ */

/** One pointer the viewport recognizer is tracking. */
interface ViewPointer {
  x: number;
  y: number;
  /** Where it went down — the tap-vs-drag test is against this, not the last frame. */
  downX: number;
  downY: number;
  /** `true` when the drawing state machine must not see this pointer. */
  claimed: boolean;
}

/**
 * The mutable state of one touch sequence, shared by down/move/up.
 *
 * Everything is in a ref for the same reason the stroke is: a pinch delivers
 * samples at pointer rate and a `setState` per sample would be exactly the cost
 * the "push + rAF" rule exists to avoid. Only the controller and the layer see
 * the result.
 */
interface ViewportGesture {
  pointers: Map<number, ViewPointer>;
  /** The most fingers that were down at once — what a tap's finger count means. */
  peak: number;
  /** `true` once the fingers actually moved: this sequence is a drag, not a tap. */
  moved: boolean;
  /** `true` while the sequence owns the view (a pan or a pinch is in flight). */
  engaged: boolean;
  /** A tap is only a tap on a touch screen; a mouse drag never becomes undo. */
  touch: boolean;
  startedAt: number;
  /** Finger spread when the pinch last re-anchored; `0` means "no pinch yet". */
  startSpread: number;
  /** Transform snapshot taken when the pan/pinch re-anchored. */
  startTransform: ViewportTransform | null;
  /** Midpoint when the pan/pinch re-anchored. */
  startMidpoint: { x: number; y: number };
}

function emptyViewportGesture(): ViewportGesture {
  return {
    pointers: new Map(),
    peak: 0,
    moved: false,
    engaged: false,
    touch: false,
    startedAt: 0,
    startSpread: 0,
    startTransform: null,
    startMidpoint: { x: 0, y: 0 },
  };
}

/**
 * Wire the pointer state machine to a canvas.
 *
 * The returned handlers are fresh on every render, but they reach the canvas
 * through the canvas's own event attributes — there are no `addEventListener`
 * calls for pointer events, so nothing needs to be re-attached and no listener
 * can hold a stale closure. Only the two **global** end-of-stroke signals
 * (`visibilitychange`, `blur`) are effects, and their cleanup is a plain
 * remove.
 */
export function useAnnotationInput(
  options: AnnotationInputOptions,
): AnnotationInput {
  // `tool` / `size` / `color` / `touchDraws` / `hidden` / `itemsRef` are read
  // through `latest` rather than bound here on purpose: a handler that lives for
  // one render would capture the tool selected when it was created, and the pen
  // would keep writing with yesterday's nib after the toolbar changed.
  const { gesture, onActiveChange, requestFrame, onGestureChange } = options;

  /**
   * Props read from *inside* a callback must come from the render that is
   * current when the callback runs. A live object ref rather than a dependency
   * array: the pointer handlers are re-created every render anyway, but the
   * effect-attached ones are not, and this is what keeps them honest.
   */
  const latest = useRef(options);
  latest.current = options;

  /** Which pointer owns the gesture, and whether a pen pointer is down. */
  const activePointers = useRef<Map<number, string>>(new Map());

  /** The touch sequence in flight, if any — see {@link ViewportGesture}. */
  const viewportRef = useRef<ViewportGesture>(emptyViewportGesture());

  /** The previous one-finger tap, for 单指双击恢复位置大小. */
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(
    null,
  );

  const penIsDown = useCallback((): boolean => {
    for (const type of activePointers.current.values()) {
      if (type === "pen") return true;
    }
    return false;
  }, []);

  /**
   * Re-take the pinch's baseline from whatever is down *now*.
   *
   * Called on every change to the finger set — the second finger landing, one of
   * three lifting, a pointer cancel — so the very next move is measured against
   * the current spread and midpoint instead of against a pair that no longer
   * exists. Without it, lifting one finger of a pinch snaps the zoom by the ratio
   * between the old and new spreads (the pdf viewer documents the same fix at its
   * `onPointerEnd`).
   */
  const reanchorViewport = useCallback(() => {
    const config = latest.current.viewport;
    const state = viewportRef.current;
    if (!config) return;
    state.startTransform = config.controller?.current() ?? null;
    state.startMidpoint = centroidOf(state.pointers.values());
    state.startSpread = spreadOf(state.pointers.values(), state.startMidpoint);
  }, []);

  const isDrawable = useCallback((pointerType: string): boolean => {
    if (pointerType === "pen") return true;
    if (pointerType === "mouse") return true;
    return pointerType === "touch" && latest.current.touchDraws;
  }, []);

  /**
   * Close the gesture in flight, idempotently.
   *
   * Called by all five end paths; `onActiveChange(false)` only fires when
   * something was actually open, so a `pointerup` after a `pointercancel` (or
   * vice versa) cannot report two ends for one stroke.
   */
  const endGesture = useCallback(() => {
    const current = gesture.current;
    if (!current || !current.active) return;

    const {
      tool: activeTool,
      size: activeSize,
      color: activeColor,
      onOperation: emit,
    } = latest.current;

    current.active = false;
    onActiveChange?.(false);

    if (activeTool === "eraser") {
      // One eraser pass is **one** operation carrying every item it deleted, so a
      // single ⌘Z restores the whole pass (design §0.3-7). Already-erased items
      // cannot be in here twice: the set is keyed by id.
      const removed = (latest.current.itemsRef.current ?? []).filter((item) =>
        current.erasedIds.has(item.id),
      );
      // The skip set is deliberately **not** cleared here. The parent lands the
      // removal a tick later, and drawing a frame between this call and that
      // one would replay the deleted marks straight back onto the screen (the
      // flash design §3.3's "立刻从画面消失" rules out). Ownership of the set
      // therefore passes to the renderer, which clears it when the `items` prop
      // actually changes — the layer having landed the deletion.
      current.points.length = 0;
      if (latest.current.eraserMode === "path") {
        const replacements = (latest.current.itemsRef.current ?? []).flatMap(
          (original) => {
            const fragments = current.replacements.get(original.id);
            return fragments
              ? [
                  {
                    original,
                    items: fragments.map((item) => ({
                      ...item,
                      id: randomId(),
                    })),
                  },
                ]
              : [];
          },
        );
        if (replacements.length) emit({ kind: "replace", replacements });
      } else if (removed.length > 0) emit({ kind: "remove", items: removed });
      requestFrame();
      return;
    }

    const points = current.points;
    // A one-point gesture **is** a mark here, whatever the pointer type: a pen tap
    // and a mouse click both land a dot, and a mouse drag is a stroke just like a
    // pen drag. Nothing delays a click or deletes it retroactively, which is why
    // 恢复位置大小 cannot ride on a desktop double click (see the file header) and
    // why a host that wants one offers a button (`pan-zoom/reset-button.tsx`).
    if (points.length > 0 && activeTool !== "pointer") {
      // Everything after the id is derived and settled here, never at sample
      // time: the id is stable for the item's whole life, `simulatePressure` is
      // decided once on release (design §4.5), `points` are thinned only on the
      // way to storage (design §3.2) and `bbox` is derived, not hand-written.
      const items = latest.current.itemsRef.current ?? [];
      let z = 0;
      for (const item of items) {
        if (item.z > z) z = item.z;
      }
      const item: Annotation = withBBox({
        ...createBrushAnnotation(
          activeTool,
          simplifyPoints(points),
          activeSize,
          activeColor,
          document.documentElement.classList.contains("dark"),
        ),
        id: randomId(),
        z: z + 1,
        createdAt: Date.now(),
      });
      current.points.length = 0;
      emit({ kind: "add", item });
    }
    requestFrame();
  }, [gesture, onActiveChange, requestFrame]);

  /* ---------------- The shared viewport ---------------- */

  /**
   * A pointer landed. Returns `true` when the viewport owns it and the drawing
   * state machine must keep its hands off.
   *
   * The order of the three cases is the whole arbitration: a pen is never a
   * viewport pointer, a mouse is only one while its middle button is down (the
   * left button draws), and a touch is one whenever it is not drawing — plus
   * **always** from the second finger on, which is why `touchDraws` can never
   * make a pinch impossible.
   */
  const handleViewportDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): boolean => {
      const config = latest.current.viewport;
      // `hidden` deliberately does not stop viewport gestures: 隐藏批注 is about
      // the ink, and panning/zooming to inspect the original is exactly what the
      // user does next. It only reaches the drawing path (see `onPointerDown`).
      if (!config) return false;

      const pointerType = event.pointerType;
      const isTouch = pointerType === "touch";
      const isMiddle =
        (pointerType === "mouse" && event.button === 1) ||
        (latest.current.tool === "pointer" && event.button === 0 && !isTouch);
      if (!isTouch && !isMiddle) return false;

      const state = viewportRef.current;
      const entry: ViewPointer = {
        x: event.clientX,
        y: event.clientY,
        downX: event.clientX,
        downY: event.clientY,
        claimed: false,
      };

      if (isTouch && penIsDown()) {
        // Palm rejection: the pen owns the surface. The touch is swallowed —
        // never drawn, never panned — until every finger is up.
        entry.claimed = true;
        state.pointers.set(event.pointerId, entry);
        return true;
      }

      if (
        isMiddle ||
        (isTouch && config.panEnabled && state.pointers.size === 0)
      ) {
        entry.claimed = true;
      }
      state.pointers.set(event.pointerId, entry);

      if (state.pointers.size === 1) {
        state.startedAt = event.timeStamp;
        state.peak = 1;
        state.moved = false;
        state.touch = isTouch;
        state.engaged = entry.claimed;
        reanchorViewport();
        return entry.claimed;
      }

      // Second finger: the viewport takes over from here, and a stroke in
      // flight has to land *before* the pinch starts, or it would keep growing
      // while the world zooms under it.
      state.peak = Math.max(state.peak, state.pointers.size);
      state.touch = state.touch || isTouch;
      endGesture();
      activePointers.current.clear();
      state.engaged = true;
      reanchorViewport();
      return true;
    },
    [endGesture, penIsDown, reanchorViewport],
  );

  /** A tracked pointer moved: pan, pinch, or report "this was a drag, not a tap". */
  const handleViewportMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): boolean => {
      const state = viewportRef.current;
      const entry = state.pointers.get(event.pointerId);
      if (!entry) return false;

      const dx = event.clientX - entry.x;
      const dy = event.clientY - entry.y;
      entry.x = event.clientX;
      entry.y = event.clientY;
      if (Math.hypot(entry.x - entry.downX, entry.y - entry.downY) > TAP_SLOP) {
        state.moved = true;
      }

      const config = latest.current.viewport;
      if (!config || !state.engaged) return entry.claimed;

      const centre = centroidOf(state.pointers.values());
      if (state.pointers.size >= 2) {
        const spread = spreadOf(state.pointers.values(), centre);
        // **A change in the fingers' spread is movement, controller or not.** It has
        // to be judged outside the `startTransform` guard below: on a host that only
        // arbitrates (no `panZoom`, so `startTransform` is null) the whole block used
        // to be skipped, and a quick two-finger pinch — each finger moving less than
        // `TAP_SLOP`, the spread more — stayed "not moved", so `classifyTapEnd` called
        // it a two-finger tap and the layer **undid the reader's last stroke**.
        if (
          state.startSpread > 0 &&
          spread > 0 &&
          Math.abs(spread - state.startSpread) > TAP_SLOP
        ) {
          state.moved = true;
        }
        if (state.startTransform && spread > 0) {
          config.controller?.pinch(
            state.startTransform,
            spread / state.startSpread,
            state.startMidpoint.x,
            state.startMidpoint.y,
            centre.x,
            centre.y,
          );
        }
      } else if (dx || dy) {
        config.controller?.panBy(dx, dy);
      }
      return true;
    },
    [],
  );

  /**
   * A tracked pointer ended. `tap` is false for `pointercancel` /
   * `lostpointercapture`: a sequence the browser took away is never a tap, and
   * reporting one would undo a stroke the user never asked to undo.
   */
  const handleViewportEnd = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, tap: boolean): boolean => {
      const state = viewportRef.current;
      const entry = state.pointers.get(event.pointerId);
      if (!entry) return false;

      const claimed = entry.claimed || state.engaged;
      state.pointers.delete(event.pointerId);

      if (state.pointers.size > 0) {
        // One of several fingers lifted: re-take the baseline so the remaining
        // fingers continue from where the view actually is. (`reanchorViewport`
        // also zeroes the spread when a lone finger is left, which turns the
        // gesture from a pinch back into a pan.)
        reanchorViewport();
        return claimed;
      }

      const config = latest.current.viewport;
      const { peak, moved, touch, startedAt } = state;
      const duration = event.timeStamp - startedAt;
      viewportRef.current = emptyViewportGesture();

      const outcome = classifyTapEnd({ tap, touch, moved, duration, peak });
      if (!config) return claimed;

      if (!outcome) {
        // A touch sequence that was not a clean one-finger tap — a drag, a press,
        // a pinch, a cancelled pointer — **closes** the double-tap window rather
        // than leaving it open: 单指双击 must be two taps in a row, not "tap …
        // pan … tap", and the second tap of such a pair is a fresh first tap. It
        // is also what keeps a mouse out of the window entirely, since only
        // touches ever reach here.
        if (touch) lastTapRef.current = null;
        return claimed;
      }

      if (outcome === "redo") {
        lastTapRef.current = null;
        config.onRedo?.();
        return claimed;
      }
      if (outcome === "undo") {
        lastTapRef.current = null;
        config.onUndo?.();
        return claimed;
      }

      // 手指=书写 turns a one-finger tap into a dot, so it must not also be the
      // first half of a double tap.
      if (!config.panEnabled) return claimed;

      const now = event.timeStamp;
      if (
        isDoubleTap(lastTapRef.current, {
          time: now,
          x: event.clientX,
          y: event.clientY,
        })
      ) {
        lastTapRef.current = null;
        config.controller?.reset();
      } else {
        lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
      }
      return claimed;
    },
    [reanchorViewport],
  );

  /**
   * The two end signals that are not pointer events on the canvas.
   *
   * Both are lifecycle-wide rather than gesture-wide, so they are attached once
   * for the component's life and removed on unmount — the same reason
   * `packages/graph/src/force/eventListener.ts` keeps a single teardown handle
   * for its DOM listeners.
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        endGesture();
        // A pinch cannot survive the tab losing focus: the `pointerup`s that
        // would have ended it are never delivered, and the next touch would be
        // measured against a finger set that has not existed for minutes.
        viewportRef.current = emptyViewportGesture();
      }
    };
    const onBlur = () => {
      endGesture();
      viewportRef.current = emptyViewportGesture();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onBlur);
      // A canvas can unmount **mid-stroke** — the pdf's ink canvases come and go with
      // its rendering window, so scrolling the page away takes the element with it.
      // Committing from the points already sampled is the rule the other end paths
      // follow; without this the stroke would be dropped instead.
      endGesture();
    };
    // Deliberately mounted once, not re-attached when `endGesture` changes
    // identity: `endGesture` reads every prop through `latest`, so re-attaching
    // would only churn the listeners. The effect owns no state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eraseAt = useCallback(
    (from: AnnotationPoint, to: AnnotationPoint) => {
      const current = gesture.current;
      const options = latest.current;
      const radius = options.size * 2;
      if (radius <= 0) return;
      const samples = eraserSamples(from, to, radius);
      let changed = false;
      for (const original of options.itemsRef.current ?? []) {
        if (options.eraserMode === "path") {
          const previous = current.replacements.get(original.id) ?? [original];
          const next = erasePath(previous, samples, radius);
          if (
            next.length !== previous.length ||
            next.some((item, i) => item !== previous[i])
          ) {
            current.replacements.set(original.id, next);
            changed = true;
          }
        } else if (
          !current.erasedIds.has(original.id) &&
          samples.some((point) => hitTestItem(original, point, radius))
        ) {
          current.erasedIds.add(original.id);
          changed = true;
        }
      }
      if (changed) onGestureChange?.();
    },
    [gesture, onGestureChange],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      // The shared viewport gets first refusal: a finger that pans, a second
      // finger that starts a pinch and a middle-button drag all stop here — and
      // they keep working while the ink is hidden.
      if (handleViewportDown(event)) return;
      if (latest.current.isNavigationGesture?.(event.nativeEvent)) return;
      // Hiding only stops *drawing* from here on.
      if (latest.current.hidden || latest.current.tool === "pointer") return;
      // So does a read-only layer: the ink is on screen, but there is nowhere to
      // put a new stroke (see `AnnotationInputOptions.readOnly`).
      if (latest.current.readOnly) return;

      const current = gesture.current;
      if (!current) return;
      // One gesture at a time: a second pointer landing mid-stroke is a palm,
      // another finger or a second stylus tip — never a second stroke.
      if (current.active) return;
      if (event.button !== 0) return;

      const pointerType = event.pointerType;
      // Palm rejection: while the pen is down every touch is dropped.
      if (
        pointerType === "touch" &&
        (penIsDown() || !latest.current.touchDraws)
      )
        return;
      if (!isDrawable(pointerType)) return;
      if (!latest.current.inBounds(event.clientX, event.clientY)) return;

      activePointers.current.set(event.pointerId, pointerType);
      current.replacements.clear();
      current.erasedIds.clear();
      current.active = true;
      current.pointerId = event.pointerId;

      // Capture as early as possible so a sequence that leaves the canvas still
      // arrives here. Failure is non-fatal (some synthetic pointers cannot be
      // captured) — the four other end paths already cover it.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignored on purpose: capture is an optimisation, not a requirement.
      }

      // The very first point is recorded **from pointerdown**, not from the first
      // `pointermove`: a quick tap delivers no move at all and would otherwise
      // lose the whole stroke (design §0.3-3).
      current.points.push(
        latest.current.onPoint(event.clientX, event.clientY, event.pressure),
      );
      if (latest.current.tool === "eraser") {
        const first = current.points[current.points.length - 1]!;
        eraseAt(first, first);
      }
      current.tick += 1;
      onActiveChange?.(true);
      requestFrame();
    },
    [
      gesture,
      eraseAt,
      handleViewportDown,
      isDrawable,
      onActiveChange,
      penIsDown,
      requestFrame,
    ],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      // A pointer the viewport owns never reaches the sampler — and a pen or a
      // drawing finger that is merely *tracked* (so a pinch can re-anchor) still
      // does, which is what `entry.claimed` decides inside the recognizer.
      if (handleViewportMove(event)) return;

      const current = gesture.current;
      if (!current || !current.active) return;
      // Only the pointer that opened the stroke may extend it (a second finger
      // or a palm is never a second sample of the pen).
      if (event.pointerId !== current.pointerId) return;

      // `pointerType` is "" when the browser cannot tell — treat that as neither.
      if (event.pointerType === "touch" && penIsDown()) return;

      const native = event.nativeEvent;
      const samples = coalescedPoints(native);
      const { onPoint: toPoint, tool: activeTool } = latest.current;

      let previous = current.points[current.points.length - 1]!;
      for (const sample of samples) {
        const point = toPoint(sample.clientX, sample.clientY, sample.pressure);
        current.points.push(point);
        if (activeTool === "eraser") eraseAt(previous, point);
        previous = point;
      }
      current.tick += 1;
      requestFrame();
    },
    [gesture, eraseAt, handleViewportMove, penIsDown, requestFrame],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (handleViewportEnd(event, true)) return;
      const current = gesture.current;
      if (!current?.active || event.pointerId !== current.pointerId) return;
      endGesture();
      activePointers.current.delete(event.pointerId);
    },
    [endGesture, gesture, handleViewportEnd],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      // The browser took the sequence over (scroll, system gesture, a Radix
      // focus trap). The stroke still has to be committed from what was sampled
      // — dropping it here is what "停在半截" looks like (design §0.3-8).
      // A cancelled *viewport* gesture is not a tap, so it never undoes anything.
      if (handleViewportEnd(event, false)) return;
      const current = gesture.current;
      if (!current?.active || event.pointerId !== current.pointerId) return;
      endGesture();
      activePointers.current.delete(event.pointerId);
    },
    [endGesture, gesture, handleViewportEnd],
  );

  const onLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (handleViewportEnd(event, false)) return;
      const current = gesture.current;
      if (!current?.active || event.pointerId !== current.pointerId) return;
      endGesture();
      activePointers.current.delete(event.pointerId);
    },
    [endGesture, gesture, handleViewportEnd],
  );

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    },
  };
}
