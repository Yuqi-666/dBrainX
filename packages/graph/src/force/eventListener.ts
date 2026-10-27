// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Main-thread DOM event capture → `ProxiedDomEvent` → Comlink RPC.
 *
 * The d3-force worker has no DOM access, so all user gestures (pointer
 * moves, wheel scrolls, two-finger touch pinches, context menus, key
 * presses) must be captured on the main thread, then forwarded via
 * `worker.proxyEvent()`.
 *
 * Zoom has **two** sources, both resolved on the main thread (the worker
 * only receives `setViewport`):
 *
 *   1. `wheel` with `ctrlKey` — a trackpad pinch or Ctrl+scroll wheel.
 *   2. Two simultaneous `pointerType === "touch"` pointers — a pinch on a
 *      touch screen. Touch screens never emit `wheel`, so this gesture is
 *      reconstructed from the raw pointer stream (see the pinch state
 *      machine inside `installDomEventProxy`).
 *
 * Modifier-key policy (per force/design.md §4.3, main design §5-§6):
 *
 *   - **Alt**: drag is inhibited on the worker (the main thread is in
 *     "create-edge" mode and shows the assist-edge). The main thread
 *     handles the assist-edge visuals itself.
 *   - **Ctrl**: drag is inhibited, instead a lasso-select flow starts
 *     in the main thread.
 *   - **Shift**: reserved for additive selection in the main thread.
 *
 * The `screenToSimulation` helper also lives here because it depends on
 * the same `ViewportState` that drives pan/zoom.
 *
 * Coordinate space: all viewport values (`x`, `y`, `scale`) are kept in
 * **device-pixel space** (matching the OffscreenCanvas backing store).
 * `screenToSimulation` multiplies CSS-pixel offsets by `devicePixelRatio`
 * so that event coords match the renderer's device-pixel transform.
 */

import type { ProxiedDomEvent, ViewportState } from "./types";
import type { Modifiers } from "../types";

// -----------------------------------------------------------------------
// Modifier extraction
// -----------------------------------------------------------------------

export function extractModifiers(
  e: MouseEvent | WheelEvent | KeyboardEvent | PointerEvent,
): Modifiers {
  return {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
  };
}

// -----------------------------------------------------------------------
// Zoom limits
// -----------------------------------------------------------------------

/**
 * Hard zoom bounds shared by the wheel handler and the two-finger pinch
 * handler, so both gestures clamp identically.
 */
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

// -----------------------------------------------------------------------
// Screen-to-simulation conversion
// -----------------------------------------------------------------------

/**
 * Convert a screen-coord (clientX/Y) point to simulation coord space.
 *
 * The worker's OffscreenCanvas + d3-force layout operate in **device-pixel**
 * space (canvas backing store = rect.width × devicePixelRatio). This
 * function multiplies the CSS-pixel offset by `dpr` so the result is
 * directly comparable with `node.x` / `node.y` in the worker.
 */
export function screenToSimulation(
  screenX: number,
  screenY: number,
  canvasRect: DOMRect,
  viewport: ViewportState,
  dpr: number,
): { x: number; y: number } {
  return {
    x: ((screenX - canvasRect.left) * dpr - viewport.x) / viewport.scale,
    y: ((screenY - canvasRect.top) * dpr - viewport.y) / viewport.scale,
  };
}

// -----------------------------------------------------------------------
// Event proxy installation
// -----------------------------------------------------------------------

export interface ProxyHandlers {
  /** Send a serialized event to the worker. */
  proxyEvent: (event: ProxiedDomEvent) => Promise<void>;
  /** Notify the main thread that the user pressed a key (for mod-state). */
  onKeyDown?: (key: string, code: string, modifiers: Modifiers) => void;
  onKeyUp?: (key: string, code: string, modifiers: Modifiers) => void;
  /** Notify the main thread that the canvas viewport changed (pan or zoom). */
  onViewportChange?: (x: number, y: number, scale: number) => void;
}

export interface InstalledListeners {
  /** Tear down all listeners (StrictMode cleanup). */
  dispose: () => void;
  /** Cancel an in-progress drag-to-pan (call when worker reports a node hit). */
  cancelPan: () => void;
}

/**
 * Install all DOM event listeners on the given element. Returns a
 * `dispose` function and a `cancelPan` function for external cancellation.
 *
 * @param dpr — `devicePixelRatio` from `globalThis.devicePixelRatio`.
 *        Must match the ratio used for canvas backing-store sizing.
 */
export function installDomEventProxy(
  target: HTMLElement,
  canvasRectRef: { current: DOMRect | null },
  viewportRef: { current: ViewportState },
  handlers: ProxyHandlers,
  dpr: number,
): InstalledListeners {
  // AbortController makes StrictMode double-mount cleanup trivial:
  // we attach with `{ signal }` so a single `abort()` removes every
  // listener we installed.
  const ac = new AbortController();
  const signal = ac.signal;

  /**
   * Convert a client (CSS-pixel) point to **device-pixel** space — the space
   * the viewport offsets (`x`/`y`) and the canvas backing store live in.
   */
  const getDeviceCoord = (clientX: number, clientY: number) => {
    // Use the cached rect from ResizeObserver when available to avoid
    // forced layout on every pointermove. Falls back to live
    // getBoundingClientRect() when the cache is cold (first event).
    const rect = canvasRectRef.current ?? target.getBoundingClientRect();
    if (!canvasRectRef.current) canvasRectRef.current = rect;
    return { x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr };
  };

  const getSimCoord = (clientX: number, clientY: number) => {
    const device = getDeviceCoord(clientX, clientY);
    return {
      x: (device.x - viewportRef.current.x) / viewportRef.current.scale,
      y: (device.y - viewportRef.current.y) / viewportRef.current.scale,
    };
  };

  // ---- Pointer-move throttle: at most one proxyEvent per rAF ---------
  let pendingPointerMove: ProxiedDomEvent | null = null;
  let pointerMoveRafId: number | null = null;

  // ---- Drag-to-pan state machine -------------------------------------
  // Pan does NOT start on pointerdown. Instead we enter "pending" and
  // only start actual panning on pointermove when:
  //   1. The pointer has moved more than a 3-device-pixel threshold
  //   2. cancelPan() has not been called (worker confirmed a node hit)
  //
  // This deferral avoids a race: without it, the first few pointermove
  // events trigger viewport panning BEFORE the async worker response
  // reaches the main thread, breaking node drag (the viewport jumps).
  let isPanning = false;
  let panPending = false;
  let panCancelled = false;
  /** Screen (CSS-pixel) position where pointerdown started. */
  let panStartX = 0;
  let panStartY = 0;
  /** Viewport at pointerdown moment — used as anchor for accumulated delta. */
  let panOriginViewportX = 0;
  let panOriginViewportY = 0;

  function cancelPan(): void {
    panCancelled = true;
    isPanning = false;
  }

  // ---- Two-finger pinch-zoom state machine (touch screens) ------------
  // Touch screens never emit `wheel` (trackpad pinch arrives as `wheel` with
  // ctrlKey), so the pinch is reconstructed from the raw touch pointers:
  //
  //   touch #1 down   → normal single-finger behaviour (pan / drag)
  //   touch #2 down   → pinch starts: the in-flight single-finger gesture is
  //                     terminated and every touch event is swallowed until
  //                     ALL fingers lift, so a pinch can never drag a node
  //                     or pan. A finger joining/leaving mid-pinch merely
  //                     re-anchors the gesture (jump-free).
  //
  // The canvas carries `touch-action: none` (ForceGraph.tsx); without it the
  // browser would claim the gesture for page zoom and never deliver the
  // second pointer's moves.
  const touchPoints = new Map<number, { x: number; y: number }>();
  let pinchActive = false;
  /** Finger distance (CSS px) at pinch start — the scale reference. */
  let pinchStartDistance = 1;
  let pinchStartScale = 1;
  /** Simulation-space point pinned under the pinch midpoint. */
  let pinchWorldX = 0;
  let pinchWorldY = 0;
  /** Set at pinch start, cleared once every touch pointer has lifted. */
  let touchGestureLocked = false;

  /** Distance + midpoint (CSS px) of the first two live touches. */
  function pinchGeometry(): {
    distance: number;
    midX: number;
    midY: number;
  } | null {
    const points = [...touchPoints.values()];
    const a = points[0];
    const b = points[1];
    if (!a || !b) return null;
    return {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  /**
   * Start — or re-anchor — a pinch from the currently tracked touches.
   * Re-anchoring is jump-free (the simulation point sitting under the
   * midpoint stays there), so it is also used when a finger joins or leaves
   * a gesture that is already locked.
   */
  function beginPinch(modifiers: Modifiers): void {
    const geo = pinchGeometry();
    const first = [...touchPoints.values()][0];
    if (!geo || !first) return;

    const mid = getDeviceCoord(geo.midX, geo.midY);
    pinchActive = true;
    pinchStartDistance = geo.distance;
    pinchStartScale = viewportRef.current.scale;
    pinchWorldX = (mid.x - viewportRef.current.x) / viewportRef.current.scale;
    pinchWorldY = (mid.y - viewportRef.current.y) / viewportRef.current.scale;

    // A pinch is neither a pan nor a node drag: drop the pending pan.
    cancelPan();
    panPending = false;
    isPanning = false;

    // A pinch already claimed this gesture — nothing else to hand over.
    if (touchGestureLocked) return;
    touchGestureLocked = true;

    // Close out the single-finger gesture that was already in flight. The
    // synthetic `pointer-up` matters: if that finger had started a node
    // drag, the worker pinned the node via `setNodeFixed(true)` and only a
    // pointer-up releases it.
    const sim = getSimCoord(first.x, first.y);
    handlers
      .proxyEvent({
        type: "pointer-up",
        x: sim.x,
        y: sim.y,
        button: 0,
        clientX: first.x,
        clientY: first.y,
        modifiers,
      })
      .catch(() => {});
  }

  /** Apply the current touch geometry to the viewport (zoom + pan). */
  function updatePinch(): void {
    const geo = pinchGeometry();
    if (!geo) return;
    const mid = getDeviceCoord(geo.midX, geo.midY);
    const scale = clampScale(
      pinchStartScale * (geo.distance / pinchStartDistance),
    );
    // Keep the simulation point that sat under the initial midpoint glued to
    // the *current* midpoint — one formula for both zooming (distance
    // changes) and two-finger panning (midpoint moves).
    viewportRef.current.scale = scale;
    viewportRef.current.x = mid.x - scale * pinchWorldX;
    viewportRef.current.y = mid.y - scale * pinchWorldY;
    handlers.onViewportChange?.(
      viewportRef.current.x,
      viewportRef.current.y,
      viewportRef.current.scale,
    );
  }

  /**
   * Touch bookkeeping for `pointerup` / `pointercancel`.
   *
   * @returns true when the event must NOT reach the worker or the pan state
   *          machine (i.e. it belongs to a gesture a pinch already claimed).
   */
  function releaseTouch(pointerId: number): boolean {
    touchPoints.delete(pointerId);
    if (pinchActive && touchPoints.size < 2) pinchActive = false;
    if (!touchGestureLocked) return false;
    if (touchPoints.size === 0) {
      // Every finger is up — the canvas is ready for a fresh gesture.
      touchGestureLocked = false;
      panPending = false;
      panCancelled = false;
      isPanning = false;
    }
    return true;
  }

  // ---- pointerdown ----------------------------------------------------
  target.addEventListener(
    "pointerdown",
    (e: PointerEvent) => {
      // Right-click is handled by the contextmenu listener below.
      if (e.button !== 0) return;

      // Refresh the cached bounding rect on every interaction start
      // to cover scroll / reflow edge cases between ResizeObserver ticks.
      canvasRectRef.current = target.getBoundingClientRect();

      // Touch pointers feed the pinch state machine. As soon as a second
      // finger lands the gesture becomes a pinch and every touch event is
      // swallowed until all fingers lift; a lone finger keeps the normal
      // pan/drag behaviour.
      if (e.pointerType === "touch") {
        touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touchPoints.size >= 2) {
          beginPinch(extractModifiers(e));
          return;
        }
        if (touchGestureLocked) return;
      }

      const sim = getSimCoord(e.clientX, e.clientY);
      const mods = extractModifiers(e);

      // Alt/Ctrl drags are reserved for create-edge / lasso — the
      // worker also inhibits node drag for these, so we skip pan too.
      if (!mods.alt && !mods.ctrl) {
        panPending = true;
        panCancelled = false;
        isPanning = false;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panOriginViewportX = viewportRef.current.x;
        panOriginViewportY = viewportRef.current.y;
      }

      handlers.proxyEvent({
        type: "pointer-down",
        x: sim.x,
        y: sim.y,
        button: e.button,
        clientX: e.clientX,
        clientY: e.clientY,
        modifiers: mods,
      }).catch(() => {});
    },
    { signal, passive: false },
  );

  // ---- pointermove ----------------------------------------------------
  target.addEventListener(
    "pointermove",
    (e: PointerEvent) => {
      // Touch: keep the pinch tracker fed, then either apply the pinch or
      // swallow the event (tail of a gesture a pinch already claimed).
      if (e.pointerType === "touch") {
        if (touchPoints.has(e.pointerId)) {
          touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        if (pinchActive) {
          e.preventDefault();
          updatePinch();
          return;
        }
        if (touchGestureLocked) return;
      }

      const sim = getSimCoord(e.clientX, e.clientY);

      // Deferred pan start: wait until the pointer has moved enough
      // AND the worker hasn't cancelled (node hit detected).
      if (panPending && !panCancelled && !isPanning) {
        const dx = Math.abs((e.clientX - panStartX) * dpr);
        const dy = Math.abs((e.clientY - panStartY) * dpr);
        if (dx > 6 || dy > 6) {
          isPanning = true;
        }
      }

      // Active pan: update viewport anchored to the pointerdown origin.
      // (panStart - currentClient) * dpr = device-pixel delta from the
      // pointerdown position — this gives a 1:1 drag-to-pan feel.
      if (isPanning) {
        viewportRef.current.x =
          panOriginViewportX + (e.clientX - panStartX) * dpr;
        viewportRef.current.y =
          panOriginViewportY + (e.clientY - panStartY) * dpr;
        handlers.onViewportChange?.(
          viewportRef.current.x,
          viewportRef.current.y,
          viewportRef.current.scale,
        );
      }

      // proxyEvent: during drag/pan (buttons held), send immediately
      // for minimal latency. Hover-only moves (no buttons) are throttled
      // to rAF to avoid redundant hit-tests.
      const isDragging = (e.buttons & 1) !== 0;
      if (isDragging) {
        handlers.proxyEvent({
          type: "pointer-move",
          x: sim.x,
          y: sim.y,
          buttons: e.buttons,
          clientX: e.clientX,
          clientY: e.clientY,
          modifiers: extractModifiers(e),
        }).catch(() => {});
      } else {
        pendingPointerMove = {
          type: "pointer-move",
          x: sim.x,
          y: sim.y,
          buttons: e.buttons,
          clientX: e.clientX,
          clientY: e.clientY,
          modifiers: extractModifiers(e),
        };
        if (pointerMoveRafId === null) {
          pointerMoveRafId = requestAnimationFrame(() => {
            pointerMoveRafId = null;
            if (pendingPointerMove) {
              handlers.proxyEvent(pendingPointerMove).catch(() => {});
              pendingPointerMove = null;
            }
          });
        }
      }
    },
    { signal, passive: false },
  );

  // ---- pointerup ------------------------------------------------------
  target.addEventListener(
    "pointerup",
    (e: PointerEvent) => {
      if (e.pointerType === "touch" && releaseTouch(e.pointerId)) return;

      isPanning = false;
      panPending = false;
      panCancelled = false;

      const sim = getSimCoord(e.clientX, e.clientY);
      handlers.proxyEvent({
        type: "pointer-up",
        x: sim.x,
        y: sim.y,
        button: e.button,
        clientX: e.clientX,
        clientY: e.clientY,
        modifiers: extractModifiers(e),
      }).catch(() => {});
    },
    { signal, passive: false },
  );

  // ---- pointercancel --------------------------------------------------
  // The browser aborts a touch pointer when it claims the gesture for
  // itself (system edge swipe, notification shade, …). Treat it as a
  // release so pan/pinch state can't get stuck, and forward a synthetic
  // pointer-up so the worker releases any node pinned by the drag.
  target.addEventListener(
    "pointercancel",
    (e: PointerEvent) => {
      if (e.pointerType === "touch" && releaseTouch(e.pointerId)) return;

      isPanning = false;
      panPending = false;
      panCancelled = false;

      const sim = getSimCoord(e.clientX, e.clientY);
      handlers.proxyEvent({
        type: "pointer-up",
        x: sim.x,
        y: sim.y,
        button: 0,
        clientX: e.clientX,
        clientY: e.clientY,
        modifiers: extractModifiers(e),
      }).catch(() => {});
    },
    { signal, passive: true },
  );

  // ---- wheel ----------------------------------------------------------
  // Two branches:
  //   ctrlKey → zoom around cursor (trackpad pinch, Ctrl+scroll wheel)
  //   else    → pan by delta (two-finger swipe, plain scroll wheel)
  //
  // Touch screens produce no wheel events at all — their pinch gesture is
  // handled by the pointer-based state machine above.
  target.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();

      const rect = target.getBoundingClientRect();

      if (e.ctrlKey) {
        // --- Zoom around cursor (trackpad pinch / Ctrl+wheel) ----------
        const mouseX = (e.clientX - rect.left) * dpr;
        const mouseY = (e.clientY - rect.top) * dpr;
        // Exponential keeps zoom-in/out symmetric (±100 → ×2 / ×0.5); the
        // naive `1 + (-deltaY) / 100` collapses to 0 when zooming out.
        const zoom = Math.pow(2, -e.deltaY / 100);
        const prevScale = viewportRef.current.scale;
        const newScale = clampScale(prevScale * zoom);
        // Anchor with the *applied* ratio, not the raw `zoom`: at the zoom
        // limits the two differ, and using the raw one would keep panning
        // the viewport while the scale no longer changes.
        const applied = newScale / prevScale;
        viewportRef.current.x =
          mouseX - applied * (mouseX - viewportRef.current.x);
        viewportRef.current.y =
          mouseY - applied * (mouseY - viewportRef.current.y);
        viewportRef.current.scale = newScale;
      } else {
        // --- Pan by scroll delta (two-finger swipe / plain wheel) ------
        const panScale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 20 : 1;
        viewportRef.current.x -= e.deltaX * panScale * dpr;
        viewportRef.current.y -= e.deltaY * panScale * dpr;
        // Clamp pan so the viewport doesn't drift to astronomically
        // large values (accumulated from many small wheel deltas).
        viewportRef.current.x = Math.max(
          -100000,
          Math.min(100000, viewportRef.current.x),
        );
        viewportRef.current.y = Math.max(
          -100000,
          Math.min(100000, viewportRef.current.y),
        );
      }

      if (handlers.onViewportChange) {
        handlers.onViewportChange(
          viewportRef.current.x,
          viewportRef.current.y,
          viewportRef.current.scale,
        );
      }
    },
    { signal, passive: false },
  );

  // ---- contextmenu ----------------------------------------------------
  target.addEventListener(
    "contextmenu",
    (e: MouseEvent) => {
      e.preventDefault();
      const sim = getSimCoord(e.clientX, e.clientY);
      handlers.proxyEvent({
        type: "context-menu",
        x: sim.x,
        y: sim.y,
        clientX: e.clientX,
        clientY: e.clientY,
        modifiers: extractModifiers(e),
      }).catch(() => {});
    },
    { signal },
  );

  // ---- keydown / keyup ------------------------------------------------
  // We attach to `window` so the canvas doesn't have to be focused.
  window.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      handlers.onKeyDown?.(e.key, e.code, extractModifiers(e));
    },
    { signal, passive: true },
  );
  window.addEventListener(
    "keyup",
    (e: KeyboardEvent) => {
      handlers.onKeyUp?.(e.key, e.code, extractModifiers(e));
    },
    { signal, passive: true },
  );

  return {
    dispose: () => {
      ac.abort();
      if (pointerMoveRafId !== null) cancelAnimationFrame(pointerMoveRafId);
    },
    cancelPan,
  };
}
