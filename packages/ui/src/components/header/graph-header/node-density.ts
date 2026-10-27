// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * The graph header's 节点密度 slider: the pure mapping between the
 * persisted boundary node density and the slider's own position.
 *
 * Kept out of the panel component so it can be tested without a DOM
 * (`node-density.test.ts`). Density spans two orders of magnitude
 * (2e-6 … 2e-4 nodes/px²), so the slider is logarithmic: position 0 is
 * `min`, position `DENSITY_SLIDER_STEPS` is `max`.
 */

/**
 * Slider range and default, in nodes per px².
 *
 * `default` mirrors `DEFAULT_FORCE_CONFIG.boundaryDensity` in
 * `@workspace/graph`, which turns it into the boundary radius
 * `sqrt(n / density)`. It is duplicated rather than imported because
 * `ui → graph` would close a package cycle (`graph` already depends on
 * `ui`); `node-density.test.ts` pins the value so a change on either
 * side is a visible test failure rather than a silent drift.
 */
export const NODE_DENSITY = {
  min: 2e-6,
  max: 2e-4,
  default: 1e-5,
} as const;

/** Slider positions; one step is one unit of the slider's range. */
export const DENSITY_SLIDER_STEPS = 100;

/** Density → slider position (log scale), clamped into the range. */
export function densityToPosition(density: number): number {
  const clamped = Math.min(
    NODE_DENSITY.max,
    Math.max(NODE_DENSITY.min, density),
  );
  const ratio =
    Math.log(clamped / NODE_DENSITY.min) /
    Math.log(NODE_DENSITY.max / NODE_DENSITY.min);
  return Math.round(ratio * DENSITY_SLIDER_STEPS);
}

/** Slider position → density. */
export function positionToDensity(position: number): number {
  return (
    NODE_DENSITY.min *
    (NODE_DENSITY.max / NODE_DENSITY.min) ** (position / DENSITY_SLIDER_STEPS)
  );
}

/** Qualitative reading shown next to the slider. */
export function densityScaleLabel(density: number): string {
  if (density <= 4e-6) return translate("宽松");
  if (density >= 4e-5) return translate("紧凑");
  return translate("标准");
}
