// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PixiJS Application lifecycle + stage hierarchy (worker-internal).
 *
 * This module owns:
 *   - `DOMAdapter.set(WebWorkerAdapter)` — MUST run before `app.init()`.
 *   - The `Application` instance (created against the worker-owned
 *     OffscreenCanvas, WebGL, manual render only).
 *   - The stage hierarchy: a single `world` Container (view-space
 *     transform) holding the grid / edges / outlines / nodes / labels
 *     layers, in that z-order.
 *   - Background color (via `renderer.background`), resize, and
 *     `contextlost` surfacing.
 *
 * Coordinate space: everything in this renderer is DEVICE pixel space —
 * the OffscreenCanvas dims and the viewport values are already device px
 * (dpr is folded in on the main thread). `world` maps simulation coords
 * → device px with `scale = viewport.scale` and
 * `position = (viewport.x, viewport.y)`. Do NOT multiply by dpr here.
 *
 * See docs/force-pixijs-migration-plan.md §D1-D5.
 */

import "pixi.js/webworker"; // static worker-environment extension registration
import {
  Application,
  Container,
  DOMAdapter,
  Graphics,
  WebWorkerAdapter,
} from "pixi.js";

// -----------------------------------------------------------------------
// Layer hierarchy (z-order: grid < edges < edge labels < assist <
// outlines < nodes < node labels)
// -----------------------------------------------------------------------

export interface ForceLayers {
  grid: Graphics;
  edges: Container;
  /** Interaction-driven edge labels (rounded chip at the edge midpoint). */
  edgeLabels: Container;
  assist: Container;
  outlines: Container;
  nodes: Container;
  labels: Container;
}

// -----------------------------------------------------------------------
// Module state
// -----------------------------------------------------------------------

let app: Application | null = null;
let world: Container | null = null;
let layers: ForceLayers | null = null;
let devicePixelRatio = 1;

// -----------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------

/**
 * Initialize the PixiJS Application against a worker-owned OffscreenCanvas
 * (WebGL). Async — callers must gate rendering on readiness (see
 * `canvas.ts` facade). If an app already exists it is torn down first.
 */
export async function createPixiApp(
  offscreen: OffscreenCanvas,
  dims: { width: number; height: number },
  dpr = 1,
): Promise<void> {
  // Must precede any renderer initialization (adapter is read at app.init).
  DOMAdapter.set(WebWorkerAdapter);

  devicePixelRatio = dpr;

  // Destroy any previous app (defensive — re-init on same worker).
  if (app) {
    try {
      app.destroy(
        { releaseGlobalResources: true },
        { children: true, texture: true, textureSource: true },
      );
    } catch {
      // Ignore partial teardown errors.
    }
  }

  app = new Application();
  await app.init({
    canvas: offscreen,
    width: dims.width,
    height: dims.height,
    antialias: true,
    backgroundAlpha: 1,
    background: "#ffffff",
    preference: "webgl",
    autoStart: false, // manual rendering only (isDirty gate in api.ts)
    sharedTicker: false,
    resolution: 1, // device-px coordinate space
  });
  app.ticker.stop();

  world = new Container();
  app.stage.addChild(world);

  layers = {
    grid: new Graphics(),
    edges: new Container(),
    edgeLabels: new Container(),
    assist: new Container(),
    outlines: new Container(),
    nodes: new Container(),
    labels: new Container(),
  };
  world.addChild(
    layers.grid,
    layers.edges,
    layers.edgeLabels,
    layers.assist,
    layers.outlines,
    layers.nodes,
    layers.labels,
  );

  // Surface WebGL context loss to the main thread (worker has no DOM UI).
  offscreen.addEventListener("contextlost", (ev) => {
    ev.preventDefault();
    try {
      self.postMessage({ type: "__ERROR__", message: "WebGL context lost" });
    } catch {
      // Message channel may already be gone.
    }
  });
}

export function getApp(): Application | null {
  return app;
}

export function getLayers(): ForceLayers | null {
  return layers;
}

export function getDevicePixelRatio(): number {
  return devicePixelRatio;
}

/** Apply the viewport transform to the world container. */
export function setWorldTransform(x: number, y: number, scale: number): void {
  if (!world) return;
  world.scale.set(scale);
  world.position.set(x, y);
}

/** Background color for the renderer clear. Accepts any CSS color. */
export function setBackgroundColor(color: string): void {
  if (!app) return;
  app.renderer.background.color = color;
}

export function resizeApp(dims: { width: number; height: number }): void {
  if (!app) return;
  app.renderer.resize(dims.width, dims.height);
}

export function destroyApp(): void {
  if (!app) return;
  try {
    app.destroy(
      { releaseGlobalResources: true },
      { children: true, texture: true, textureSource: true },
    );
  } catch {
    // Ignore partial teardown errors.
  }
  app = null;
  world = null;
  layers = null;
}

// -----------------------------------------------------------------------
// Frustum culling (shared by the leaf renderers)
// -----------------------------------------------------------------------

export interface Frustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Visible simulation-space bounds with a padding margin (PAD = 50 sim
 * units, mirroring the Canvas 2D renderer's frustum culling — covers
 * node radii + label height).
 */
export function computeFrustum(
  viewport: { x: number; y: number; scale: number },
  dims: { width: number; height: number },
  pad = 50,
): Frustum {
  const invScale = 1 / viewport.scale;
  return {
    left: -viewport.x * invScale - pad,
    right: (-viewport.x + dims.width) * invScale + pad,
    top: -viewport.y * invScale - pad,
    bottom: (-viewport.y + dims.height) * invScale + pad,
  };
}

export function isInFrustum(
  x: number | undefined,
  y: number | undefined,
  f: Frustum,
): boolean {
  if (x === undefined || y === undefined) return false;
  return x >= f.left && x <= f.right && y >= f.top && y <= f.bottom;
}
