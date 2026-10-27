// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared edge-geometry math — a port of the @antv/g6 v1 edge curve
 * computation into force-mode's Pixi renderer + hit-tester.
 *
 * Why this module exists: the edge renderer (`pixi/edges.ts`) and the edge
 * hit-tester (`simulation.ts`) must agree on exactly where a curved edge
 * lies, or a user can click a visible curve and miss it. Previously both
 * files duplicated ad-hoc control-point formulas that could drift. This
 * module is the single source of truth for:
 *
 *   - edge-kind classification (line / quadratic / cubic),
 *   - the G6 v1 control-point math (`getCurveControlPoint` — projection
 *     onto the source→target line plus a perpendicular offset),
 *   - endpoint intersection with the circular node boundary,
 *   - arrow tangent angles at each end,
 *   - curve sampling / point-distance helpers for dashing and hit-testing.
 *
 * Geometry contract (mirrors @antv/g6 v1 `utils/edge.ts`):
 *   - quadratic: control = getCurveControlPoint(S, T, 0.5, +30)
 *   - cubic:     C1 = getCurveControlPoint(S, T, 0.5, +20),
 *                C2 = getCurveControlPoint(S, T, 0.5, -20)  (symmetric S)
 *   - endpoints: circle-boundary intersection toward the opposite center
 *                (`getEllipseIntersectPoint` degenerate to a circle).
 *
 * Pure functions only — no simulation or renderer state. Safe to call from
 * the worker render path and the hit-test path on every frame.
 */

import type { EdgeDirection } from "@workspace/interfaces";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

/** A node reduced to the three numbers the edge geometry needs. */
export interface EdgeEndpoint {
  x: number;
  y: number;
  radius: number;
}

/** Edge shape (mirrors `ForceLinkSeed.shape`). */
export type EdgeShape = "straight" | "curve" | "s-curve";

/** Concrete path kind, resolved from shape + direction. */
export type EdgeKind = "line" | "quadratic" | "cubic";

/** Fully-resolved edge geometry for one link. */
export interface ResolvedEdgeGeometry {
  kind: EdgeKind;
  /** Source endpoint (on the source node boundary, toward target). */
  sx: number;
  sy: number;
  /** Target endpoint (on the target node boundary, toward source). */
  tx: number;
  ty: number;
  /** Quadratic control point / cubic first control point. */
  c1x: number;
  c1y: number;
  /** Cubic second control point (unused for line / quadratic). */
  c2x: number;
  c2y: number;
  /** Tangent angle (radians) at the target end — arrow direction. */
  endAngle: number;
  /** Tangent angle (radians) at the source end — reverse arrow. */
  startAngle: number;
}

// -----------------------------------------------------------------------
// Constants (G6 v1 curve defaults)
// -----------------------------------------------------------------------

/** Arrow-head size, matches v1 `endArrowSize: 8`. */
export const ARROW_SIZE = 8;

/** Fallback node radius for defensive `?? DEFAULT_NODE_RADIUS` calls. */
export const DEFAULT_NODE_RADIUS = 8;

/** Quadratic curve parameters (v1 quadratic `curvePosition` / `curveOffset`). */
export const QUADRATIC_CURVE = { position: 0.5, offset: 30 } as const;

/** Cubic curve parameters (v1 cubic `curvePosition` / `curveOffset`). */
export const CUBIC_CURVE = { position: 0.5, offset: 20 } as const;

// -----------------------------------------------------------------------
// Vector helpers (port of @antv/g6 `utils/vector.ts`)
// -----------------------------------------------------------------------

function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

/** G6 `perpendicular([x, y], clockwise=false)` = `[y, -x]` (un-normalized). */
function perpendicular(x: number, y: number): { x: number; y: number } {
  return { x: y, y: -x };
}

// -----------------------------------------------------------------------
// Edge-kind classification
// -----------------------------------------------------------------------

/**
 * Resolve the concrete path kind from a link's shape + direction.
 * Mirrors v1 `createEdgeOptions().type`: bidirectional → cubic, flow →
 * quadratic, hierarchy/association → line.
 */
export function resolveEdgeKind(
  shape: EdgeShape,
  direction: EdgeDirection,
): EdgeKind {
  if (direction === "bidirectional" || shape === "s-curve") return "cubic";
  if (shape === "curve") return "quadratic";
  return "line";
}

// -----------------------------------------------------------------------
// Control-point math (port of G6 `getCurveControlPoint`)
// -----------------------------------------------------------------------

/**
 * Compute a bezier control point from two endpoints.
 *
 * G6 v1 formula: project onto the source→target line at `position`
 * (0..1), then offset `offset` px along the unit perpendicular.
 *
 *     v = T − S
 *     P = S + position · v
 *     n = normalize(perpendicular(v))
 *     C = P + offset · n
 */
export function getCurveControlPoint(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  position: number,
  offset: number,
): { x: number; y: number } {
  if (sx === tx && sy === ty) return { x: sx, y: sy };
  const vx = tx - sx;
  const vy = ty - sy;
  const perp = perpendicular(vx, vy);
  const n = normalize(perp.x, perp.y);
  return {
    x: sx + position * vx + offset * n.x,
    y: sy + position * vy + offset * n.y,
  };
}

// -----------------------------------------------------------------------
// Endpoint intersection (port of G6 `getEllipseIntersectPoint`, circle)
// -----------------------------------------------------------------------

/**
 * Point on a circle's boundary at the angle pointing toward `toward`.
 * Port of G6 `getEllipseIntersectPoint` for the degenerate circle case
 * (rx = ry = radius), used for node-boundary endpoints.
 */
export function getCircleIntersectPoint(
  cx: number,
  cy: number,
  radius: number,
  towardX: number,
  towardY: number,
): { x: number; y: number } {
  const angle = Math.atan2(towardY - cy, towardX - cx);
  if (Number.isNaN(angle)) return { x: cx, y: cy };
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

// -----------------------------------------------------------------------
// Full geometry resolution
// -----------------------------------------------------------------------

/**
 * Resolve all geometry for one link: boundary endpoints, control points,
 * and tangent angles. Pure function — no simulation or renderer state.
 *
 * Callers must guard self-loops (`source === target`) before invoking —
 * this assumes two distinct node centers.
 */
export function resolveEdgeGeometry(
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  shape: EdgeShape,
  direction: EdgeDirection,
): ResolvedEdgeGeometry {
  const kind = resolveEdgeKind(shape, direction);

  // Endpoints on the node boundaries, toward the opposite center.
  const s = getCircleIntersectPoint(
    source.x,
    source.y,
    source.radius,
    target.x,
    target.y,
  );
  const t = getCircleIntersectPoint(
    target.x,
    target.y,
    target.radius,
    source.x,
    source.y,
  );

  let c1x = 0;
  let c1y = 0;
  let c2x = 0;
  let c2y = 0;
  let endAngle = Math.atan2(t.y - s.y, t.x - s.x);
  let startAngle = Math.atan2(s.y - t.y, s.x - t.x);

  if (kind === "quadratic") {
    const c1 = getCurveControlPoint(
      s.x,
      s.y,
      t.x,
      t.y,
      QUADRATIC_CURVE.position,
      QUADRATIC_CURVE.offset,
    );
    c1x = c1.x;
    c1y = c1.y;
    endAngle = Math.atan2(t.y - c1y, t.x - c1x);
    startAngle = Math.atan2(s.y - c1y, s.x - c1x);
  } else if (kind === "cubic") {
    const c1 = getCurveControlPoint(
      s.x,
      s.y,
      t.x,
      t.y,
      CUBIC_CURVE.position,
      CUBIC_CURVE.offset,
    );
    const c2 = getCurveControlPoint(
      s.x,
      s.y,
      t.x,
      t.y,
      CUBIC_CURVE.position,
      -CUBIC_CURVE.offset,
    );
    c1x = c1.x;
    c1y = c1.y;
    c2x = c2.x;
    c2y = c2.y;
    endAngle = Math.atan2(t.y - c2y, t.x - c2x);
    startAngle = Math.atan2(s.y - c1y, s.x - c1x);
  }

  return {
    kind,
    sx: s.x,
    sy: s.y,
    tx: t.x,
    ty: t.y,
    c1x,
    c1y,
    c2x,
    c2y,
    endAngle,
    startAngle,
  };
}

// -----------------------------------------------------------------------
// Curve sampling (dash decomposition)
// -----------------------------------------------------------------------

/**
 * Point at the middle of the resolved edge path (bezier `t = 0.5`).
 * Used to anchor the interaction-driven edge label at the visual center
 * of the curve rather than the chord midpoint.
 */
export function resolveEdgeMidpoint(geom: ResolvedEdgeGeometry): {
  x: number;
  y: number;
} {
  if (geom.kind === "cubic") {
    // B(0.5) = (P0 + 3·C1 + 3·C2 + P1) / 8
    return {
      x: (geom.sx + 3 * geom.c1x + 3 * geom.c2x + geom.tx) / 8,
      y: (geom.sy + 3 * geom.c1y + 3 * geom.c2y + geom.ty) / 8,
    };
  }
  if (geom.kind === "quadratic") {
    // B(0.5) = (P0 + 2·C + P1) / 4
    return {
      x: (geom.sx + 2 * geom.c1x + geom.tx) / 4,
      y: (geom.sy + 2 * geom.c1y + geom.ty) / 4,
    };
  }
  return { x: (geom.sx + geom.tx) / 2, y: (geom.sy + geom.ty) / 2 };
}

/** Sample a quadratic bezier into `n+1` points. */
export function sampleQuadratic(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  n = 24,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * x0 + 2 * u * t * cx + t * t * x1,
      u * u * y0 + 2 * u * t * cy + t * t * y1,
    ]);
  }
  return pts;
}

/** Sample a cubic bezier into `n+1` points. */
export function sampleBezier(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x1: number,
  y1: number,
  n = 32,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * u * x0 +
        3 * u * u * t * cx1 +
        3 * u * t * t * cx2 +
        t * t * t * x1,
      u * u * u * y0 +
        3 * u * u * t * cy1 +
        3 * u * t * t * cy2 +
        t * t * t * y1,
    ]);
  }
  return pts;
}

// -----------------------------------------------------------------------
// Point-to-edge distance (hit-testing)
// -----------------------------------------------------------------------

/** Minimum distance from point to a line segment. */
export function pointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

/** Minimum distance from point to a quadratic bezier (sampled). */
export function pointToQuadraticCurve(
  px: number,
  py: number,
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  tx: number,
  ty: number,
): number {
  const pts = sampleQuadratic(sx, sy, cx, cy, tx, ty, 10);
  let min = Infinity;
  for (const [x, y] of pts) min = Math.min(min, Math.hypot(px - x, py - y));
  return min;
}

/** Minimum distance from point to a cubic bezier (sampled). */
export function pointToCubicCurve(
  px: number,
  py: number,
  sx: number,
  sy: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  tx: number,
  ty: number,
): number {
  const pts = sampleBezier(sx, sy, cx1, cy1, cx2, cy2, tx, ty, 10);
  let min = Infinity;
  for (const [x, y] of pts) min = Math.min(min, Math.hypot(px - x, py - y));
  return min;
}
