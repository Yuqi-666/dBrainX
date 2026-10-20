// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Edge + node-outline rendering: style-bucketed Graphics.
 *
 * Edges are grouped by a style signature (stroke color / width / dash /
 * shape / direction / shadow) — one `Graphics` per bucket, one `stroke()`
 * per bucket, so draw calls scale with style-count, not edge-count.
 *
 * Node strokes (+ interaction shadows) are drawn on a separate
 * `outlines` layer so the pooled node Sprites (nodes.ts) keep a clean
 * single-texture batch.
 *
 * Shadow approximation: Pixi Graphics has no per-element shadowBlur, so a
 * shadow is approximated with a wider translucent "glow" stroke under the
 * crisp stroke (visually close for the small blur radii in the render
 * rules). Dashed/dotted lines are decomposed into alternating segments
 * (Pixi v8 stroke() has no dash support); curves are sampled first.
 *
 * Self-loops now use the link's own style (the Canvas 2D renderer
 * accidentally used the previous frame's style state).
 *
 * See docs/force-pixijs-migration-plan.md §D5.
 */

import { Graphics } from "pixi.js";
import type { AltDragAssistRender, SimLink, SimNode } from "../simulation";
import type { ViewportState } from "../../types";
import {
  EDGE_RENDER_RULES,
  NODE_RENDER_RULES,
  getRenderAdjustment,
} from "../../styleConfig";
import {
  ARROW_SIZE,
  DEFAULT_NODE_RADIUS,
  resolveEdgeGeometry,
  sampleBezier,
  sampleQuadratic,
} from "../edgeGeometry";
import { computeFrustum, getLayers, isInFrustum, type Frustum } from "./app";

// -----------------------------------------------------------------------
// Style bucketing
// -----------------------------------------------------------------------

const edgeBuckets = new Map<string, Graphics>();
/** crisp node-outline buckets (keyed by style signature). */
const outlineBuckets = new Map<string, Graphics>();
/** glow underlay buckets for node outlines with a shadow. */
const outlineGlowBuckets = new Map<string, Graphics>();

/** Per-edge style key cache (persistent across frames, cleared on initData). */
const styleKeyCache = new Map<string, string>();
/** Per-node outline style key cache. */
const outlineKeyCache = new Map<string, string>();

/** Invalidate all style key caches (call on initData / applyDiff / teardown). */
export function clearStyleKeyCaches(): void {
  styleKeyCache.clear();
  outlineKeyCache.clear();
}

/** Resolved paint style for one link (render-state adjustments applied). */
export interface EdgeRenderStyle {
  color: string;
  width: number;
  shadow?: { color: string; blur: number };
}

/**
 * Resolve a link's effective stroke style — the same computation the edge
 * buckets paint with. Exported so the edge-label renderer can stroke its
 * background with the exact color/width of the edge it belongs to.
 */
export function resolveEdgeRenderStyle(link: SimLink): EdgeRenderStyle {
  const adj = getRenderAdjustment(link.renderState, EDGE_RENDER_RULES);
  return {
    color: adj?.strokeColorOverride ?? link.strokeColor,
    width: adj?.strokeWidthMultiplier
      ? link.strokeWidth * adj.strokeWidthMultiplier
      : link.strokeWidth,
    shadow: adj?.shadow,
  };
}

function edgeStyleKey(link: SimLink): string {
  const cached = styleKeyCache.get(link.id as string);
  if (cached) return cached;
  const { color, width, shadow } = resolveEdgeRenderStyle(link);
  const shape = link.shape + (link.direction === "bidirectional" ? ":bi" : "");
  const shadowKey = shadow ? `|${shadow.color}:${shadow.blur}` : "";
  const key = `${color}|${width}|${link.strokeType}|${shape}${shadowKey}`;
  styleKeyCache.set(link.id as string, key);
  return key;
}

function nodeOutlineStyleKey(node: SimNode): string {
  const cached = outlineKeyCache.get(node.id as string);
  if (cached) return cached;
  const adj = getRenderAdjustment(node.renderState, NODE_RENDER_RULES);
  const color = adj?.strokeColorOverride ?? node.strokeColor;
  const width = adj?.strokeWidthMultiplier
    ? node.strokeWidth * adj.strokeWidthMultiplier
    : node.strokeWidth;
  const shadow = adj?.shadow ? `|${adj.shadow.color}:${adj.shadow.blur}` : "";
  const key = `${color}|${width}${shadow}`;
  outlineKeyCache.set(node.id as string, key);
  return key;
}

// -----------------------------------------------------------------------
// Edges
// -----------------------------------------------------------------------

/**
 * Rebuild all edge bucket Graphics for one frame. Visible edges only
 * (both endpoints outside the frustum are skipped — single endpoint
 * visible still draws, the edge may cross the viewport boundary).
 */
export function syncEdgeGraphics(
  links: ReadonlyArray<SimLink>,
  viewport: ViewportState,
  dims: { width: number; height: number },
): void {
  const layers = getLayers();
  if (!layers) return;
  const frustum = computeFrustum(viewport, dims);

  const groups = new Map<string, SimLink[]>();
  for (const link of links) {
    if (!edgeVisible(link, frustum)) continue;
    const key = edgeStyleKey(link);
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(link);
  }

  // Prune buckets whose style no longer appears.
  for (const [key, g] of edgeBuckets) {
    if (!groups.has(key)) {
      layers.edges.removeChild(g);
      g.destroy();
      edgeBuckets.delete(key);
    }
  }

  for (const [key, group] of groups) {
    let g = edgeBuckets.get(key);
    if (!g) {
      g = new Graphics();
      edgeBuckets.set(key, g);
      layers.edges.addChild(g);
    }
    g.clear();

    const first = group[0];
    if (!first) continue;
    const adj = getRenderAdjustment(first.renderState, EDGE_RENDER_RULES);
    const color = adj?.strokeColorOverride ?? first.strokeColor;
    const width = adj?.strokeWidthMultiplier
      ? first.strokeWidth * adj.strokeWidthMultiplier
      : first.strokeWidth;

    if (adj?.shadow) {
      // Glow underlay first (wider translucent stroke), then crisp stroke.
      for (const link of group) buildEdgePath(g, link);
      g.stroke({
        width: width + adj.shadow.blur,
        color: adj.shadow.color,
        cap: "round",
        join: "round",
      });
      for (const link of group) buildEdgePath(g, link);
    } else {
      for (const link of group) buildEdgePath(g, link);
    }
    g.stroke({ width, color, cap: "butt", join: "miter" });

    // Arrow heads — filled with the bucket color, no shadow (matches the
    // Canvas 2D renderer where shadowBlur was reset before drawArrow).
    for (const link of group) drawArrows(g, link);
    g.fill({ color });
  }
}

function edgeVisible(link: SimLink, f: Frustum): boolean {
  return (
    isInFrustum(link.source.x, link.source.y, f) ||
    isInFrustum(link.target.x, link.target.y, f)
  );
}

function buildEdgePath(g: Graphics, link: SimLink): void {
  if (link.source === link.target) {
    buildSelfLoop(g, link);
    return;
  }

  const geom = resolveEdgeGeometry(
    {
      x: link.source.x ?? 0,
      y: link.source.y ?? 0,
      radius: link.source.radius ?? DEFAULT_NODE_RADIUS,
    },
    {
      x: link.target.x ?? 0,
      y: link.target.y ?? 0,
      radius: link.target.radius ?? DEFAULT_NODE_RADIUS,
    },
    link.shape,
    link.direction,
  );
  if (
    !Number.isFinite(geom.sx) ||
    !Number.isFinite(geom.sy) ||
    !Number.isFinite(geom.tx) ||
    !Number.isFinite(geom.ty)
  ) {
    return;
  }

  const dash =
    link.strokeType === "dashed"
      ? { len: 6, gap: 4 }
      : link.strokeType === "dotted"
        ? { len: 2, gap: 4 }
        : null;

  if (dash) {
    if (geom.kind === "cubic") {
      drawDashedPolyline(
        g,
        sampleBezier(
          geom.sx,
          geom.sy,
          geom.c1x,
          geom.c1y,
          geom.c2x,
          geom.c2y,
          geom.tx,
          geom.ty,
        ),
        dash.len,
        dash.gap,
      );
    } else if (geom.kind === "quadratic") {
      drawDashedPolyline(
        g,
        sampleQuadratic(geom.sx, geom.sy, geom.c1x, geom.c1y, geom.tx, geom.ty),
        dash.len,
        dash.gap,
      );
    } else {
      drawDashedLine(g, geom.sx, geom.sy, geom.tx, geom.ty, dash.len, dash.gap);
    }
    return;
  }

  if (geom.kind === "cubic") {
    g.moveTo(geom.sx, geom.sy);
    g.bezierCurveTo(geom.c1x, geom.c1y, geom.c2x, geom.c2y, geom.tx, geom.ty);
  } else if (geom.kind === "quadratic") {
    g.moveTo(geom.sx, geom.sy);
    g.quadraticCurveTo(geom.c1x, geom.c1y, geom.tx, geom.ty);
  } else {
    g.moveTo(geom.sx, geom.sy);
    g.lineTo(geom.tx, geom.ty);
  }
}

function buildSelfLoop(g: Graphics, link: SimLink): void {
  const x = link.source.x ?? 0;
  const y = link.source.y ?? 0;
  const r = link.source.radius ?? DEFAULT_NODE_RADIUS;
  const loopR = r + 12;
  g.arc(x, y - loopR, 8, -Math.PI * 0.8, Math.PI * 0.8);
}

// -----------------------------------------------------------------------
// Arrows
// -----------------------------------------------------------------------

function drawArrows(g: Graphics, link: SimLink): void {
  if (link.source === link.target) {
    drawSelfLoopArrow(g, link);
    return;
  }

  const geom = resolveEdgeGeometry(
    {
      x: link.source.x ?? 0,
      y: link.source.y ?? 0,
      radius: link.source.radius ?? DEFAULT_NODE_RADIUS,
    },
    {
      x: link.target.x ?? 0,
      y: link.target.y ?? 0,
      radius: link.target.radius ?? DEFAULT_NODE_RADIUS,
    },
    link.shape,
    link.direction,
  );
  if (
    !Number.isFinite(geom.sx) ||
    !Number.isFinite(geom.sy) ||
    !Number.isFinite(geom.tx) ||
    !Number.isFinite(geom.ty)
  ) {
    return;
  }

  if (link.direction === "forward" || link.direction === "bidirectional") {
    drawArrowHead(g, geom.tx, geom.ty, geom.endAngle, ARROW_SIZE);
  }
  if (link.direction === "reverse" || link.direction === "bidirectional") {
    drawArrowHead(g, geom.sx, geom.sy, geom.startAngle, ARROW_SIZE);
  }
}

function drawSelfLoopArrow(g: Graphics, link: SimLink): void {
  const x = link.source.x ?? 0;
  const y = link.source.y ?? 0;
  const r = link.source.radius ?? DEFAULT_NODE_RADIUS;
  const loopR = r + 12;
  drawArrowHead(g, x + 8, y - loopR - 8, -Math.PI / 2, 6);
}

function drawArrowHead(
  g: Graphics,
  x: number,
  y: number,
  angle: number,
  size: number,
): void {
  const half = size / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Local triangle (0,0), (-size,-half), (-size,half) rotated by angle
  // then translated to (x, y) — mirrors the Canvas 2D translate/rotate.
  g.moveTo(x, y);
  g.lineTo(x - size * cos + half * sin, y - size * sin - half * cos);
  g.lineTo(x - size * cos - half * sin, y - size * sin + half * cos);
  g.closePath();
}

// -----------------------------------------------------------------------
// Node outlines (stroke + shadow)
// -----------------------------------------------------------------------

/**
 * Rebuild node outline buckets for one frame. Visible nodes only. Each
 * bucket strokes the accumulated circle paths once; shadowed buckets get
 * an additional wider translucent glow stroke underneath.
 */
export function syncNodeOutlines(
  nodes: ReadonlyArray<SimNode>,
  viewport: ViewportState,
  dims: { width: number; height: number },
): void {
  const layers = getLayers();
  if (!layers) return;
  const frustum = computeFrustum(viewport, dims);

  const groups = new Map<string, SimNode[]>();
  for (const node of nodes) {
    if (!isInFrustum(node.x, node.y, frustum)) continue;
    const key = nodeOutlineStyleKey(node);
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(node);
  }

  // Prune buckets whose style no longer appears.
  for (const [key, g] of outlineBuckets) {
    if (!groups.has(key)) {
      layers.outlines.removeChild(g);
      g.destroy();
      outlineBuckets.delete(key);
    }
  }
  for (const [key, g] of outlineGlowBuckets) {
    if (!groups.has(key)) {
      layers.outlines.removeChild(g);
      g.destroy();
      outlineGlowBuckets.delete(key);
    }
  }

  for (const [key, group] of groups) {
    const first = group[0];
    if (!first) continue;
    const adj = getRenderAdjustment(first.renderState, NODE_RENDER_RULES);
    const color = adj?.strokeColorOverride ?? first.strokeColor;
    const width = adj?.strokeWidthMultiplier
      ? first.strokeWidth * adj.strokeWidthMultiplier
      : first.strokeWidth;

    let g = outlineBuckets.get(key);
    if (!g) {
      g = new Graphics();
      outlineBuckets.set(key, g);
      layers.outlines.addChild(g);
    }
    g.clear();
    for (const node of group) {
      g.circle(node.x ?? 0, node.y ?? 0, node.radius);
    }
    g.stroke({ width, color, cap: "butt", join: "miter" });

    if (adj?.shadow) {
      let glow = outlineGlowBuckets.get(key);
      if (!glow) {
        glow = new Graphics();
        outlineGlowBuckets.set(key, glow);
        layers.outlines.addChild(glow);
      }
      glow.clear();
      for (const node of group) {
        glow.circle(node.x ?? 0, node.y ?? 0, node.radius);
      }
      glow.stroke({
        width: width + adj.shadow.blur,
        color: adj.shadow.color,
        cap: "round",
        join: "round",
      });
    }
  }
}

// -----------------------------------------------------------------------
// Alt-drag assist edges (temporary dashed lines following the cursor)
// -----------------------------------------------------------------------

const ASSIST_STROKE = "#1890ff";
const ASSIST_WIDTH = 2;
const ASSIST_DASH_LEN = 4;
const ASSIST_DASH_GAP = 4;

let assistGraphics: Graphics | null = null;

export function syncAssistEdges(assist: AltDragAssistRender): void {
  const layers = getLayers();
  if (!layers) return;

  if (!assist.active || assist.sourcePoints.length === 0) {
    if (assistGraphics) {
      layers.assist.removeChild(assistGraphics);
      assistGraphics.destroy();
      assistGraphics = null;
    }
    return;
  }

  if (!assistGraphics) {
    assistGraphics = new Graphics();
    layers.assist.addChild(assistGraphics);
  }
  assistGraphics.clear();

  for (const src of assist.sourcePoints) {
    drawDashedLine(
      assistGraphics,
      src.x,
      src.y,
      assist.targetPoint.x,
      assist.targetPoint.y,
      ASSIST_DASH_LEN,
      ASSIST_DASH_GAP,
    );
  }
  assistGraphics.stroke({
    width: ASSIST_WIDTH,
    color: ASSIST_STROKE,
    cap: "round",
    join: "round",
  });
}

// -----------------------------------------------------------------------
// Dash helpers (Pixi v8 stroke() has no dash support)
// -----------------------------------------------------------------------

function drawDashedLine(
  g: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dashLen: number,
  gapLen: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return;
  const ux = dx / dist;
  const uy = dy / dist;
  let t = 0;
  while (t < dist) {
    const t2 = Math.min(t + dashLen, dist);
    g.moveTo(x0 + ux * t, y0 + uy * t);
    g.lineTo(x0 + ux * t2, y0 + uy * t2);
    t += dashLen + gapLen;
  }
}

/** Walk a sampled polyline emitting dash segments based on path distance. */
function drawDashedPolyline(
  g: Graphics,
  pts: ReadonlyArray<[number, number]>,
  dashLen: number,
  gapLen: number,
): void {
  const period = dashLen + gapLen;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    if (!prev || !curr) continue;
    const [x0, y0] = prev;
    const [x1, y1] = curr;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 0.0001) continue;
    const ux = dx / segLen;
    const uy = dy / segLen;
    let t = 0;
    while (t < segLen) {
      const phase = (total + t) % period;
      const inDash = phase < dashLen;
      const step = Math.min(
        segLen - t,
        inDash ? dashLen - phase : period - phase,
      );
      if (inDash) {
        g.moveTo(x0 + ux * t, y0 + uy * t);
        g.lineTo(x0 + ux * (t + step), y0 + uy * (t + step));
      }
      t += step;
    }
    total += segLen;
  }
}
