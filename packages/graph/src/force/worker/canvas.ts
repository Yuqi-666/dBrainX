// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PixiJS WebGL renderer facade (runs inside the WebWorker, migration complete).
 *
 * Delegates actual rendering to the PixiJS layers in `./pixi/*`. The
 * `api.ts` and `force.worker.ts` callers remain unchanged.
 *
 * Responsibilities:
 *   - Own the worker-created (Phase 1) or main-thread-transferred (Phase 2)
 *     OffscreenCanvas (WebGL for Pixi) plus a hidden 1×1 2D canvas used
 *     ONLY for `measureText` label truncation (contract preserved for
 *     `api.ts` computeLabels / `simulation.ts` populateNodeLabels).
 *   - Gate rendering on async Pixi App readiness — frames pushed before
 *     init resolves are skipped (api.ts's isDirty/scheduleFrame loop keeps
 *     retrying while the simulation is active).
 *   - Own the current `ForceStyle` / viewport, applying the viewport
 *     transform to the Pixi world container and background color to the
 *     renderer.
 *   - Phase 2: the OffscreenCanvas is transferred from the main thread
 *     via `createCanvasFromMain()`. PixiJS renders directly into the
 *     page-visible canvas — zero-copy GPU compositing.
 */

import type { ForceStyle, ViewportState } from "../types";
import {
  createPixiApp,
  destroyApp,
  getApp,
  resizeApp,
  setBackgroundColor,
  setWorldTransform,
} from "./pixi/app";
import { syncEdgeGraphics, syncNodeOutlines, syncAssistEdges, clearStyleKeyCaches } from "./pixi/edges";

// Re-exported for api.ts — must clear after selection/hover state changes
export { clearStyleKeyCaches };
import { syncGrid, clearGridCache } from "./pixi/grid";
import { clearLabelPools, syncLabels } from "./pixi/labels";
import { syncNodeSprites } from "./pixi/nodes";
import { readSimulationState, readAltDragState } from "./simulation";

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------

let offscreen: OffscreenCanvas | null = null;
/** Hidden 2D context used only for measureText (label truncation). */
let measureCtx: OffscreenCanvasRenderingContext2D | null = null;

let currentStyle: ForceStyle | null = null;
let viewport: ViewportState = { x: 0, y: 0, scale: 1 };
let dims = { width: 800, height: 600 };
let appReady = false;
let lastBackground: string | null = null;

// -----------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------

/**
 * Create the worker-owned OffscreenCanvas (WebGL for Pixi) and a hidden
 * 1×1 2D measuring canvas. Pixi init is async — rendering is gated on it
 * (see `appReady`); init failures surface via the `__ERROR__` channel.
 */
export function createCanvas(width: number, height: number): void {
  if (offscreen) return; // Already initialized (from main thread or prior call).
  dims = { width, height };

  offscreen = new OffscreenCanvas(width, height);
  // Sanity check: a WebGL context must be obtainable in this worker.
  const gl = offscreen.getContext("webgl");
  if (!gl) {
    throw new Error(
      "[canvas] WebGL context unavailable on OffscreenCanvas in worker",
    );
  }

  // Hidden 2D canvas for measureText (truncateLabel contract).
  const measure = new OffscreenCanvas(1, 1);
  measureCtx = measure.getContext("2d");
  if (!measureCtx) {
    throw new Error("[canvas] 2D context unavailable on measurement canvas");
  }

  appReady = false;
  lastBackground = null;
  clearStyleKeyCaches();
  clearGridCache();
  clearLabelPools();
  createPixiApp(offscreen, dims, 1)
    .then(() => {
      appReady = true;
      // A resize may have arrived while init was in flight.
      if (
        offscreen &&
        (offscreen.width !== dims.width || offscreen.height !== dims.height)
      ) {
        resizeApp(dims);
      }
      if (currentStyle) setBackgroundColor(currentStyle.backgroundColor);
      if (viewport) setWorldTransform(viewport.x, viewport.y, viewport.scale);
      // Trigger initial render now that PixiJS is ready. If the
      // simulation has already cooled (alpha < alphaMin), no tick
      // will fire to schedule a frame — without this call the canvas
      // stays blank permanently.
      renderFrame();
    })
    .catch((err: unknown) => {
      postError(`Pixi init failed: ${String(err)}`);
    });
}

export function createCanvasFromMain(
  canvas: OffscreenCanvas,
  width: number,
  height: number,
  dpr = 1,
): void {
  dims = { width, height };
  offscreen = canvas;

  const measure = new OffscreenCanvas(1, 1);
  measureCtx = measure.getContext("2d");
  if (!measureCtx) {
    throw new Error("[canvas] 2D context unavailable on measurement canvas");
  }

  appReady = false;
  lastBackground = null;
  clearStyleKeyCaches();
  clearLabelPools();
  createPixiApp(offscreen, dims, dpr)
    .then(() => {
      appReady = true;
      if (
        offscreen &&
        (offscreen.width !== dims.width || offscreen.height !== dims.height)
      ) {
        resizeApp(dims);
      }
      if (currentStyle) setBackgroundColor(currentStyle.backgroundColor);
      if (viewport) setWorldTransform(viewport.x, viewport.y, viewport.scale);
      renderFrame();
    })
    .catch((err: unknown) => {
      postError(`Pixi init failed: ${String(err)}`);
    });
}

export function setStyle(style: ForceStyle): void {
  currentStyle = style;
  if (appReady && style) setBackgroundColor(style.backgroundColor);
}

export function setViewport(v: ViewportState): void {
  viewport = v;
  if (appReady) setWorldTransform(v.x, v.y, v.scale);
}

export function getContext(): OffscreenCanvasRenderingContext2D | null {
  return measureCtx;
}

export function resizeCanvas(d: { width: number; height: number }): void {
  dims = d;
  if (!offscreen) return;
  if (appReady) {
    resizeApp(dims);
  } else {
    // Pixi not ready yet — createCanvas's .then() picks up the latest dims.
    offscreen.width = d.width;
    offscreen.height = d.height;
  }
}

// -----------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------

/**
 * Render a single frame. All layers are synced to current simulation state
 * then `app.render()` flushes the WebGL pipeline. Phase 2 renders directly
 * into the main-thread-transferred OffscreenCanvas (zero-copy compositing).
 */
export function renderFrame(): void {
  if (!offscreen || !appReady || !currentStyle) return;
  const app = getApp();
  if (!app) return;

  if (currentStyle.backgroundColor !== lastBackground) {
    lastBackground = currentStyle.backgroundColor;
    setBackgroundColor(lastBackground);
  }

  const { nodes, links } = readSimulationState();
  const assist = readAltDragState();

  syncGrid(viewport, dims, currentStyle);
  syncEdgeGraphics(links, viewport, dims);
  syncAssistEdges(assist);
  syncNodeOutlines(nodes, viewport, dims);
  syncNodeSprites(nodes, viewport, dims);
  syncLabels(nodes, links, viewport, dims, currentStyle);

  app.render();
}

// -----------------------------------------------------------------------
// Label truncation (unchanged contract — used by api.ts computeLabels)
// -----------------------------------------------------------------------

/**
 * Rough character-based truncation to keep the label within ~maxWidth.
 * Uses the canvas measureText to estimate width. Exported for label
 * pre-computation during data ingestion (see api.ts initData).
 */
export function truncateLabel(
  text: string,
  maxWidth: number,
  c: OffscreenCanvasRenderingContext2D,
): string {
  if (c.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid) + ellipsis;
    if (c.measureText(candidate).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo) + ellipsis;
}

// -----------------------------------------------------------------------
// Teardown (future worker-reuse path; not currently called)
// -----------------------------------------------------------------------

export function teardownRenderer(): void {
  appReady = false;
  clearStyleKeyCaches();
  clearGridCache();
  clearLabelPools();
  destroyApp();
  offscreen = null;
  measureCtx = null;
  currentStyle = null;
  lastBackground = null;
}

// -----------------------------------------------------------------------
// Error reporting
// -----------------------------------------------------------------------

function postError(msg: string): void {
  try {
    self.postMessage({ type: "__ERROR__", message: msg });
  } catch {
    // The message channel may already be gone (worker is shutting down).
  }
}
