// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Label rendering: pooled `Text` objects with budget + LOD.
 *
 * Two independent label families share this module:
 *
 *   1. **Node labels** — always-on (within `LABEL_BUDGET` + LOD gate).
 *   2. **Edge labels** — hidden by default; they surface only while the
 *      user interacts with an edge or one of its endpoints (see
 *      `edgeLabelVisible`). Rendered as a white rounded chip at the edge
 *      midpoint, stroked with the edge's own (render-state-adjusted)
 *      color and width.
 *
 * Phase 3 performance tuning adds a priority-based label budget
 * (`LABEL_BUDGET` = 100) and a zoom-level LOD gate
 * (`TRANSFORM_THRESHOLD` = 1). Below the threshold scale all labels are
 * hidden regardless of budget.
 *
 * Text rasterization is expensive (canvas + GPU upload per change), so
 * `.text` / style are only reassigned when they actually differ — labels
 * only change on seed upsert, never per tick.
 *
 * See docs/force-pixijs-migration-plan.md §D5, §3.1.
 */

import { CanvasTextMetrics, Container, Graphics, Text } from "pixi.js";
import type { SimLink, SimNode } from "../simulation";
import type { ForceStyle, ViewportState } from "../../types";
import {
  DEFAULT_LABEL_COLOR,
  EDGE_LABEL_BG_COLOR,
  EDGE_LABEL_BG_RADIUS,
  EDGE_LABEL_BUDGET,
  EDGE_LABEL_PAD_X,
  EDGE_LABEL_PAD_Y,
  LABEL_BUDGET,
  TRANSFORM_THRESHOLD,
  resolveDefaultLabelColor,
} from "../../styleConfig";
import {
  DEFAULT_NODE_RADIUS,
  resolveEdgeGeometry,
  resolveEdgeMidpoint,
} from "../edgeGeometry";
import { resolveEdgeRenderStyle } from "./edges";
import {
  computeFrustum,
  getApp,
  getDevicePixelRatio,
  getLayers,
  isInFrustum,
  type Frustum,
} from "./app";

const labelPool = new Map<string, Text>();

/** One pooled edge label: white rounded chip + centered text. */
interface EdgeLabelEntry {
  container: Container;
  bg: Graphics;
  text: Text;
}

const edgeLabelPool = new Map<string, EdgeLabelEntry>();

/**
 * Drop every pooled label object. Called from `canvas.ts` on (re)creation
 * and teardown so a fresh Pixi app never receives stale `Text`/`Graphics`
 * instances created against a destroyed renderer.
 */
export function clearLabelPools(): void {
  for (const [, entry] of edgeLabelPool) {
    entry.container.destroy({ children: true });
  }
  edgeLabelPool.clear();
  for (const [, t] of labelPool) t.destroy();
  labelPool.clear();
}

/**
 * Priority score for label visibility. Higher = shown first. Mirrors
 * anytype's priority ordering: selected/hovered > root (no parent edges)
 * > high-degree > everything else.
 */
function labelPriority(node: SimNode, links: ReadonlyArray<SimLink>): number {
  if (node.renderState === "active") return 5;
  if (node.renderState === "selected") return 4;
  if (node.renderState === "hover") return 3;

  // Root: node is never a link target (no incoming edges).
  const isRoot = !links.some((l) => l.target.id === node.id);
  if (isRoot) return 2;

  // Degree: total edges where this node is source or target.
  let degree = 0;
  for (const l of links) {
    if (l.source.id === node.id || l.target.id === node.id) degree++;
  }
  return 1 + Math.min(degree, 999) / 1000; // fractional tie-break
}

// -----------------------------------------------------------------------
// Edge labels (interaction-driven)
// -----------------------------------------------------------------------

/** A node is "highlighted" when the user hovers or clicks it. */
function isNodeHighlighted(node: SimNode): boolean {
  return (
    node.renderState === "hover" ||
    node.renderState === "selected" ||
    node.renderState === "active"
  );
}

/**
 * Edge labels are hidden by default. They become visible only while the
 * user interacts with the edge or one of its endpoints:
 *
 *   - either endpoint is hovered / selected / active (clicked), or
 *   - the edge itself is selected (`edge:click`), which also covers the
 *     both-endpoints-selected case.
 */
function edgeLabelVisible(link: SimLink): boolean {
  if (!link.label) return false;
  if (link.renderState === "selected") return true;
  return isNodeHighlighted(link.source) || isNodeHighlighted(link.target);
}

/** Midpoint of the drawn edge path (self-loops anchor above the loop). */
function edgeLabelPosition(link: SimLink): { x: number; y: number } | null {
  const sx = link.source.x ?? 0;
  const sy = link.source.y ?? 0;
  const tx = link.target.x ?? 0;
  const ty = link.target.y ?? 0;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;

  if (link.source === link.target) {
    const r = link.source.radius ?? DEFAULT_NODE_RADIUS;
    return { x: sx, y: sy - r - 28 };
  }

  const geom = resolveEdgeGeometry(
    { x: sx, y: sy, radius: link.source.radius ?? DEFAULT_NODE_RADIUS },
    { x: tx, y: ty, radius: link.target.radius ?? DEFAULT_NODE_RADIUS },
    link.shape,
    link.direction,
  );
  if (
    !Number.isFinite(geom.sx) ||
    !Number.isFinite(geom.sy) ||
    !Number.isFinite(geom.tx) ||
    !Number.isFinite(geom.ty)
  ) {
    return null;
  }
  return resolveEdgeMidpoint(geom);
}

/**
 * Sync the interaction-driven edge label chips for one frame. The chip is
 * a white rounded rect stroked with the edge's resolved (state-aware)
 * color/width, with the edge label centered inside it.
 */
function syncEdgeLabels(
  links: ReadonlyArray<SimLink>,
  frustum: Frustum,
  showAny: boolean,
): void {
  const layers = getLayers();
  if (!layers) return;
  const resolution = getDevicePixelRatio();

  const visibleIds = new Set<string>();
  if (showAny) {
    let shown = 0;
    for (const link of links) {
      if (shown >= EDGE_LABEL_BUDGET) break;
      if (!edgeLabelVisible(link)) continue;
      const mid = edgeLabelPosition(link);
      if (!mid || !isInFrustum(mid.x, mid.y, frustum)) continue;

      const id = link.id as string;
      visibleIds.add(id);
      shown++;

      const style = resolveEdgeRenderStyle(link);
      let entry = edgeLabelPool.get(id);
      if (!entry) {
        const container = new Container();
        const bg = new Graphics();
        const text = new Text({
          text: link.label,
          style: {
            fontFamily: "sans-serif",
            fontSize: link.labelSize,
            fill: link.labelColor,
          },
          resolution,
        });
        text.anchor.set(0.5, 0.5);
        container.addChild(bg, text);
        layers.edgeLabels.addChild(container);
        entry = { container, bg, text };
        edgeLabelPool.set(id, entry);
      }

      const { container, bg, text } = entry;
      if (text.text !== link.label) text.text = link.label;
      if (text.style.fontSize !== link.labelSize) {
        text.style.fontSize = link.labelSize;
      }
      if (text.style.fill !== link.labelColor) {
        text.style.fill = link.labelColor;
      }

      // White chip sized to the measured text. Measuring directly (rather
      // than reading `text.width`) keeps the chip geometry independent of
      // Pixi's lazy Text-bounds refresh timing.
      const metrics = CanvasTextMetrics.measureText(link.label, text.style);
      const w = metrics.width + EDGE_LABEL_PAD_X * 2;
      const h = metrics.height + EDGE_LABEL_PAD_Y * 2;
      bg.clear();
      bg.roundRect(-w / 2, -h / 2, w, h, EDGE_LABEL_BG_RADIUS);
      bg.fill({ color: EDGE_LABEL_BG_COLOR });
      bg.stroke({ width: style.width, color: style.color });

      container.position.set(Math.round(mid.x), Math.round(mid.y));
    }
  }

  // Prune pooled chips whose edge is no longer highlighted / visible.
  for (const [id, entry] of edgeLabelPool) {
    if (!visibleIds.has(id)) {
      layers.edgeLabels.removeChild(entry.container);
      entry.container.destroy({ children: true });
      edgeLabelPool.delete(id);
    }
  }
}

/**
 * Update pooled labels for one frame. Labels are sorted by priority;
 * only the top `LABEL_BUDGET` are visible. When `viewport.scale` falls
 * below `TRANSFORM_THRESHOLD`, all labels are hidden (LOD gate).
 */
export function syncLabels(
  nodes: ReadonlyArray<SimNode>,
  links: ReadonlyArray<SimLink>,
  viewport: ViewportState,
  dims: { width: number; height: number },
  style?: ForceStyle,
): void {
  const app = getApp();
  const layers = getLayers();
  if (!app || !layers) return;

  const resolution = getDevicePixelRatio();
  const frustum = computeFrustum(viewport, dims);
  const visibleIds = new Set<string>();

  // LOD gate: hide all labels below the zoom threshold.
  const showAny = viewport.scale >= TRANSFORM_THRESHOLD;

  // Edge labels are interaction-driven (hidden by default) and live on
  // their own layer beneath the node labels.
  syncEdgeLabels(links, frustum, showAny);

  // Resolved once per frame — the background only changes on updateStyle,
  // so the dark/light judgment is independent of how many labels render.
  const bgLabelColor = style
    ? resolveDefaultLabelColor(style.backgroundColor ?? "#ffffff")
    : DEFAULT_LABEL_COLOR;

  // Sort visible label candidates by priority, cap at LABEL_BUDGET.
  const ranked = nodes
    .filter((n) => {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      return (
        n.label &&
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        isInFrustum(x, y, frustum)
      );
    })
    .sort((a, b) => labelPriority(b, links) - labelPriority(a, links));
  const budgetSet = new Set(
    ranked.slice(0, Math.max(0, LABEL_BUDGET)).map((n) => n.id as string),
  );

  for (const node of ranked) {
    const id = node.id as string;
    visibleIds.add(id);

    const label = node.__label ?? node.label;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    // Default-color labels adapt to the background; explicit per-node
    // overrides (business/client layers) pass through untouched.
    const fill =
      node.labelColor === DEFAULT_LABEL_COLOR ? bgLabelColor : node.labelColor;

    let t = labelPool.get(id);
    if (!t) {
      t = new Text({
        text: label,
        style: {
          fontFamily: "sans-serif",
          fontSize: node.labelSize,
          fill,
        },
        resolution,
      });
      t.anchor.set(0.5, 0);
      labelPool.set(id, t);
      layers.labels.addChild(t);
    } else {
      if (t.text !== label) t.text = label;
      if (t.style.fontSize !== node.labelSize)
        t.style.fontSize = node.labelSize;
      if (t.style.fill !== fill) t.style.fill = fill;
    }

    t.visible = showAny && budgetSet.has(id);
    t.position.set(Math.round(x), Math.round(y + node.radius + 4));
  }

  // Also track non-visible nodes for pool pruning.
  for (const node of nodes) {
    const id = node.id as string;
    if (!visibleIds.has(id)) {
      const t = labelPool.get(id);
      if (t) t.visible = false;
      visibleIds.add(id);
    }
  }

  // Prune labels for nodes that no longer exist.
  for (const [id, t] of labelPool) {
    if (!visibleIds.has(id)) {
      layers.labels.removeChild(t);
      t.destroy();
      labelPool.delete(id);
    }
  }
}
