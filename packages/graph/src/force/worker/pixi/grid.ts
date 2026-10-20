// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Grid rendering: a single world-anchored `Graphics` (simulation space,
 * under the world transform) rebuilt only when the viewport or dims
 * change. Hairline via `lineWidth = 0.5 / scale` (local units, so the
 * world transform cancels it to a constant 0.5 device px). Visible only
 * when `scale > 0.5` and a grid color is set — matching the Canvas 2D
 * renderer.
 *
 * `"dots"` renders via a tiled `FillPattern` (one rect + one pattern fill)
 * instead of per-intersection circles. The legacy loop is O(visible world
 * area / step²) — the dot count explodes quadratically whenever the
 * viewport covers a large world area (big window or zoomed out), while the
 * pattern is O(1) geometry at any zoom. The tile is re-rasterized per
 * scale bucket so dot diameter stays a constant device size, matching the
 * old renderer exactly.
 *
 * See docs/force-pixijs-migration-plan.md §D5.
 */

import { FillPattern, Matrix, Texture } from "pixi.js";
import type { ForceStyle, ViewportState } from "../../types";
import { getLayers } from "./app";

const GRID_STEP = 50;
/** Dot diameter target in device px (constant at any zoom). */
const GRID_DOT_RADIUS = 1.5;

/** Cache key of the last rebuilt grid (viewport + dims + color + style). */
let lastKey = "";

// -----------------------------------------------------------------------
// Dots — tiled FillPattern (O(1) geometry at any zoom)
// -----------------------------------------------------------------------

/** Dot tile texture resolution (px). One tile spans GRID_STEP world units. */
const DOT_TILE_RES = 512;

/**
 * Scale bucket key (¼-octave). The dot tile is rasterized per bucket so a
 * zoom gesture regenerates it a handful of times instead of every frame.
 */
function dotScaleBucket(scale: number): number {
  return Math.round(Math.log2(scale) * 4) / 4;
}

let dotCanvas: OffscreenCanvas | null = null;
let dotTexture: Texture | null = null;
let dotPattern: FillPattern | null = null;
let dotPatternBucket = Number.NaN;
let dotPatternColor = "";

/**
 * Build (or reuse) the tiled dot pattern for the current zoom.
 *
 * The tile is GRID_STEP × GRID_STEP world units with a single dot at its
 * center; the pattern transform maps texture px → local coords so the dot
 * lands on world (0,0) and tiles repeat every GRID_STEP — dots stay glued
 * to world grid intersections at every pan/zoom. The dot is rasterized at
 * `DOT_TILE_RES` px with radius `GRID_DOT_RADIUS / scale` (cancelled by
 * the world transform) to keep a constant device size.
 *
 * Returns `null` if a 2D raster context is unavailable (callers fall back
 * to the legacy circle loop).
 */
function getDotPattern(scale: number, color: string): FillPattern | null {
  const bucket = dotScaleBucket(scale);
  if (dotPattern && dotPatternBucket === bucket && dotPatternColor === color) {
    return dotPattern;
  }

  if (!dotCanvas) dotCanvas = new OffscreenCanvas(DOT_TILE_RES, DOT_TILE_RES);
  const ctx = dotCanvas.getContext("2d");
  if (!ctx) return null;

  const radiusPx = Math.max(
    0.5,
    (GRID_DOT_RADIUS * DOT_TILE_RES) / (GRID_STEP * scale),
  );
  ctx.clearRect(0, 0, DOT_TILE_RES, DOT_TILE_RES);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(DOT_TILE_RES / 2, DOT_TILE_RES / 2, radiusPx, 0, Math.PI * 2);
  ctx.fill();

  if (!dotTexture) {
    dotTexture = Texture.from(dotCanvas);
  } else {
    dotTexture.source.update();
  }

  const worldPerPx = GRID_STEP / DOT_TILE_RES;
  const pattern = new FillPattern({
    texture: dotTexture,
    repetition: "repeat",
    textureSpace: "global",
  });
  // texture px (u,v) → local (u·worldPerPx + tx, ...): the texture center
  // (the dot) maps to local (0,0) and the tile repeats every GRID_STEP.
  pattern.setTransform(
    new Matrix(worldPerPx, 0, 0, worldPerPx, -GRID_STEP / 2, -GRID_STEP / 2),
  );

  dotPattern = pattern;
  dotPatternBucket = bucket;
  dotPatternColor = color;
  return pattern;
}

/**
 * Invalidate the grid caches. Call on worker (re)init and teardown — the
 * dot Texture is bound to the Pixi renderer and must be recreated with it.
 */
export function clearGridCache(): void {
  lastKey = "";
  if (dotTexture) {
    try {
      dotTexture.destroy(true);
    } catch {
      // Texture may already be destroyed by renderer teardown.
    }
  }
  dotCanvas = null;
  dotTexture = null;
  dotPattern = null;
  dotPatternBucket = Number.NaN;
  dotPatternColor = "";
}

export function syncGrid(
  viewport: ViewportState,
  dims: { width: number; height: number },
  style: ForceStyle,
): void {
  const layers = getLayers();
  if (!layers) return;

  // `undefined` keeps the legacy always-visible grid for views that never
  // set an explicit style; explicit "none" hides the layer.
  const bgStyle = style.backgroundStyle ?? "grid";
  const gridColor = style.gridColor;
  if (!(viewport.scale > 0.5 && bgStyle !== "none" && gridColor)) {
    layers.grid.visible = false;
    return;
  }
  layers.grid.visible = true;

  const key = `${viewport.x},${viewport.y},${viewport.scale},${dims.width},${dims.height},${gridColor},${bgStyle}`;
  if (key === lastKey) return;
  lastKey = key;

  const g = layers.grid;
  g.clear();

  const invScale = 1 / viewport.scale;
  const startX = Math.floor((-viewport.x * invScale) / GRID_STEP) * GRID_STEP;
  const startY = Math.floor((-viewport.y * invScale) / GRID_STEP) * GRID_STEP;
  const endX = startX + dims.width * invScale + GRID_STEP;
  const endY = startY + dims.height * invScale + GRID_STEP;

  if (bgStyle === "dots") {
    const pattern = getDotPattern(viewport.scale, gridColor);
    if (pattern) {
      // O(1): one rect + one tiled pattern fill, regardless of zoom.
      g.rect(startX, startY, endX - startX, endY - startY).fill(pattern);
      return;
    }
    // Defensive fallback — legacy per-intersection circles.
    const radius = GRID_DOT_RADIUS / viewport.scale;
    for (let gx = startX; gx <= endX; gx += GRID_STEP) {
      for (let gy = startY; gy <= endY; gy += GRID_STEP) {
        g.circle(gx, gy, radius);
      }
    }
    g.fill({ color: gridColor });
    return;
  }

  for (let gx = startX; gx <= endX; gx += GRID_STEP) {
    g.moveTo(gx, startY);
    g.lineTo(gx, endY);
  }
  for (let gy = startY; gy <= endY; gy += GRID_STEP) {
    g.moveTo(startX, gy);
    g.lineTo(endX, gy);
  }

  g.stroke({ width: 0.5 / viewport.scale, color: gridColor });
}
