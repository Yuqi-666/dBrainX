// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Node rendering: pooled Sprites sharing one white circle texture, tinted
 * per node (`tint = fillColor`). Render rules never change fill (see
 * force/AGENTS.md §6.5), so the tint is static between seed upserts.
 *
 * Node stroke + shadow live in `edges.ts` (`syncNodeOutlines`) on a
 * separate Graphics layer — putting them on the sprites would break
 * sprite batching.
 *
 * See docs/force-pixijs-migration-plan.md §D5.
 */

import { Graphics, Sprite, type Texture } from "pixi.js";
import type { SimNode } from "../simulation";
import type { ViewportState } from "../../types";
import { computeFrustum, getApp, getLayers, isInFrustum } from "./app";

const TEXTURE_SIZE = 64; // white circle texture is TEXTURE_SIZE x TEXTURE_SIZE

let circleTexture: Texture | null = null;
const spritePool = new Map<string, Sprite>();
/** nodeId → last applied fillColor (guard per-frame tint parsing). */
const tintCache = new Map<string, string>();

/**
 * Update the pooled node sprites for one frame. Creates sprites for new
 * nodes, removes destroyed ones, and updates position / scale / tint /
 * visibility for the rest. Reads `node.x/y` (d3-mutated in place).
 */
export function syncNodeSprites(
  nodes: ReadonlyArray<SimNode>,
  viewport: ViewportState,
  dims: { width: number; height: number },
): void {
  const app = getApp();
  const layers = getLayers();
  if (!app || !layers) return;

  if (!circleTexture) {
    const g = new Graphics()
      .circle(TEXTURE_SIZE / 2, TEXTURE_SIZE / 2, TEXTURE_SIZE / 2)
      .fill(0xffffff);
    circleTexture = app.renderer.generateTexture(g);
    g.destroy();
  }

  const frustum = computeFrustum(viewport, dims);
  const visibleIds = new Set<string>();

  for (const node of nodes) {
    const id = node.id as string;
    visibleIds.add(id);

    let sprite = spritePool.get(id);
    if (!sprite) {
      sprite = new Sprite(circleTexture);
      sprite.anchor.set(0.5);
      spritePool.set(id, sprite);
      layers.nodes.addChild(sprite);
    }

    const x = node.x ?? 0;
    const y = node.y ?? 0;
    sprite.position.set(x, y);
    sprite.scale.set((2 * node.radius) / TEXTURE_SIZE);

    // fillColor only changes on seed upsert — avoid re-parsing per frame.
    if (tintCache.get(id) !== node.fillColor) {
      sprite.tint = node.fillColor;
      tintCache.set(id, node.fillColor);
    }

    sprite.visible = isInFrustum(x, y, frustum);
  }

  // Prune sprites for nodes that no longer exist.
  for (const [id, sprite] of spritePool) {
    if (!visibleIds.has(id)) {
      layers.nodes.removeChild(sprite);
      sprite.destroy();
      spritePool.delete(id);
      tintCache.delete(id);
    }
  }
}
