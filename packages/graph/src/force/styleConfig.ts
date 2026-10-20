// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Force mode PRIVATE style configuration.
 *
 * Four-layer style pipeline (lower → higher priority):
 *   1. Defaults — baseline visual properties.
 *   2. Business layer — stateData.server (runtime business state) + semantic.color (external joined data).
 *   3. Client layer — stateData.client.style (explicit display overrides from user).
 *   4. Render layer — worker interaction state (hover/select/active) applied at paint time.
 *
 * Merge order: defaults → business → client → worker
 *
 * All visual properties (layers 1–3) are resolved on the main thread during
 * seed construction. The worker only applies render rules at canvas paint time.
 */

import type { EdgeClientStyle, NodeClientStyle } from "@workspace/interfaces";
import type { ForceConfig, RenderState } from "./types";

// -----------------------------------------------------------------------
// 1. Defaults
// -----------------------------------------------------------------------

// The resolved style shapes are exactly the interfaces' client-style
// shapes (`NodeClientStyle` / `EdgeClientStyle`). We reuse them instead of
// maintaining parallel definitions — `Required<>` expresses "every field
// has been resolved by the time the seeds are built".

/** Default node label color on light backgrounds. */
export const DEFAULT_LABEL_COLOR = "#1f2937";

/** Default node label color on dark backgrounds. */
export const DARK_BG_LABEL_COLOR = "#f3f4f6";

/** WCAG-relative luminance threshold below which a background is "dark". */
const LABEL_BG_LUMINANCE_THRESHOLD = 140;

/** True when the hex color is dark enough that default text should flip light. */
export function isDarkBackgroundColor(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const rgb = match?.[1];
  if (!rgb) return false;
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < LABEL_BG_LUMINANCE_THRESHOLD;
}

/** Picks the legible default label color for a given background color. */
export function resolveDefaultLabelColor(backgroundColor: string): string {
  return isDarkBackgroundColor(backgroundColor)
    ? DARK_BG_LABEL_COLOR
    : DEFAULT_LABEL_COLOR;
}

export const NODE_DEFAULTS: Required<NodeClientStyle> = {
  fillColor: "#165DFF",
  strokeColor: "#165DFF",
  strokeWidth: 2,
  labelColor: DEFAULT_LABEL_COLOR,
  labelSize: 14,
  radius: 8,
};

export const EDGE_DEFAULTS: Required<EdgeClientStyle> = {
  strokeColor: "#91caff",
  strokeWidth: 2,
  labelColor: "#9ca3af",
  labelSize: 12,
  shape: "straight",
  strokeType: "solid",
};

// -----------------------------------------------------------------------
// 2. Business layer (stateData.server + external joined data)
// -----------------------------------------------------------------------

export interface BusinessStyleRule {
  field: string;
  mapping: Record<string, Partial<NodeClientStyle>>;
}

export const NODE_BUSINESS_RULES: BusinessStyleRule[] = [];

export interface EdgeBusinessStyleRule {
  field: string;
  mapping: Record<string, Partial<EdgeClientStyle>>;
}

export const EDGE_BUSINESS_RULES: EdgeBusinessStyleRule[] = [];

/**
 * Merge `stateData` over a complete set of defaults using the given rules.
 * `defaults` must already be fully resolved (`Required<T>`), so the result
 * is guaranteed to carry every visual property — the worker never has to
 * fall back to a style table.
 */
export function resolveBusinessStyle<T extends object>(
  stateData: Record<string, unknown> | undefined,
  rules: ReadonlyArray<{ field: string; mapping: Record<string, Partial<T>> }>,
  defaults: Required<T>,
): Required<T> {
  if (!stateData) return defaults;
  const result: Required<T> = { ...defaults };
  for (const rule of rules) {
    const value = stateData[rule.field];
    if (value === undefined || value === null) continue;
    const key = String(value);
    const overrides = rule.mapping[key];
    if (overrides) Object.assign(result, overrides);
  }
  return result;
}

// -----------------------------------------------------------------------
// 3. Render rules (worker interaction state → canvas paint-time adjustments)
// -----------------------------------------------------------------------

export interface WorkerRenderRule {
  condition: "selected" | "hover" | "active" | "neighbor" | "inactive";
  adjust: {
    strokeWidthMultiplier?: number;
    strokeColorOverride?: string;
    shadow?: { color: string; blur: number };
  };
}

export const NODE_RENDER_RULES: WorkerRenderRule[] = [
  {
    condition: "active",
    adjust: {
      strokeWidthMultiplier: 2.0,
      strokeColorOverride: "#FF9500",
      shadow: { color: "rgba(255,149,0,0.5)", blur: 8 },
    },
  },
  {
    condition: "selected",
    adjust: {
      strokeWidthMultiplier: 1.5,
      strokeColorOverride: "#FF7D00",
      shadow: { color: "rgba(255,125,0,0.3)", blur: 5 },
    },
  },
  {
    condition: "hover",
    adjust: {
      strokeWidthMultiplier: 1.25,
      strokeColorOverride: "#4080FF",
      shadow: { color: "rgba(22,93,255,0.2)", blur: 5 },
    },
  },
  {
    condition: "neighbor",
    adjust: { strokeColorOverride: "#FFB266", shadow: { color: "rgba(255,178,102,0.15)", blur: 5 } },
  },
  {
    condition: "inactive",
    adjust: { strokeColorOverride: "#9ca3af" },
  },
];

export const EDGE_RENDER_RULES: WorkerRenderRule[] = [
  {
    condition: "active",
    adjust: {
      strokeWidthMultiplier: 2.0,
      strokeColorOverride: "#FF9500",
      shadow: { color: "rgba(255,149,0,0.5)", blur: 8 },
    },
  },
  {
    condition: "selected",
    adjust: {
      strokeWidthMultiplier: 1.5,
      strokeColorOverride: "#FF7D00",
      shadow: { color: "rgba(255,125,0,0.3)", blur: 5 },
    },
  },
  {
    condition: "hover",
    adjust: {
      strokeWidthMultiplier: 1.25,
      strokeColorOverride: "#4080FF",
      shadow: { color: "rgba(22,93,255,0.2)", blur: 5 },
    },
  },
  {
    condition: "neighbor",
    adjust: { strokeColorOverride: "#FFB266", shadow: { color: "rgba(255,178,102,0.15)", blur: 5 } },
  },
  {
    condition: "inactive",
    adjust: { strokeColorOverride: "#9ca3af" },
  },
];

export function getRenderAdjustment(
  renderState: RenderState | undefined,
  rules: ReadonlyArray<WorkerRenderRule>,
): WorkerRenderRule["adjust"] | undefined {
  if (!renderState || renderState === "default") return undefined;
  return rules.find((r) => r.condition === renderState)?.adjust;
}

// -----------------------------------------------------------------------
// Default simulation parameters
// -----------------------------------------------------------------------

export interface DefaultForceConfig {
  strength: number;
  collisionRadius: number;
  linkDistance: number;
  centerX: number;
  centerY: number;
  boundaryDensity: number;
  boundaryStrength: number;
  alphaMin: number;
  alphaDecay: number;
  velocityDecay: number;
}

export const DEFAULT_FORCE_CONFIG = {
  strength: -300,
  collisionRadius: 12,
  linkDistance: 80,
  centerX: 0,
  centerY: 0,
  // Soft circular boundary: radius = sqrt(nodeCount / boundaryDensity).
  // 1e-5 px^-2 puts 150 nodes at r ~= 3873px, 600 nodes at r ~= 7746px.
  // Stiffness 0.05 with velocityDecay 0.4 gives the discrete spring real
  // eigenvalues, so a node beyond the boundary returns monotonically: the
  // overshoot shrinks by (1.5 * 0.05) per tick and the force fades to
  // zero at the boundary, so nothing crosses or oscillates.
  boundaryDensity: 1e-5,
  boundaryStrength: 0.05,
  alphaMin: 0.001,
  alphaDecay: 0.0228,
  velocityDecay: 0.4,
} as const satisfies Partial<ForceConfig>;

// -----------------------------------------------------------------------
// Label rendering budget (Phase 3)
// -----------------------------------------------------------------------

/** Max visible labels per frame. Surfaces the highest-priority nodes only. */
export const LABEL_BUDGET = 100;

/** Viewport scale below which all labels are hidden (LOD gate). */
export const TRANSFORM_THRESHOLD = 1;

// -----------------------------------------------------------------------
// Edge label rendering (interaction-driven)
// -----------------------------------------------------------------------

/**
 * Max visible edge labels per frame. Edge labels are only shown for edges
 * connected to a hovered/selected node (or the selected edge itself), so
 * this is a safety cap for very high-degree nodes.
 */
export const EDGE_LABEL_BUDGET = 50;

/** Edge label background (opaque so the edge line never shows through). */
export const EDGE_LABEL_BG_COLOR = "#ffffff";

/** Corner radius of the edge label background. */
export const EDGE_LABEL_BG_RADIUS = 4;

/** Horizontal / vertical padding of the edge label background. */
export const EDGE_LABEL_PAD_X = 5;
export const EDGE_LABEL_PAD_Y = 2;
