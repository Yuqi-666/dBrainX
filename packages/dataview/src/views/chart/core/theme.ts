// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart theme — the app's canvas tokens to the partial theme VChart merges over
 * its own.
 *
 * VChart's built-in `dark` theme is only a *colour-scheme* swap (its components
 * resolve their colours through `{ type: "palette", key: … }` references), so
 * `type: "dark"` already themes axes, labels and the tooltip. What it cannot
 * know is which background the app paints its panes with or which font stack
 * `next/font` hashed — those are the two things this module adds, plus the pane
 * padding the shell handed the chart.
 *
 * Pure module: no React, no VChart runtime (the spec's `theme` field is plain
 * data, and the library type is structural).
 */
import type { DataViewThemeTokens } from "../../../shared/theme-tokens";
import { resolveCanvasFontFamily } from "../../../shared/theme-tokens";
import { CHART_FIXED } from "./config";

/** The theme object the spec carries under `theme`. */
export interface ChartThemeVars {
  type: "light" | "dark";
  background: string;
  fontFamily: string;
  padding: number;
}

/**
 * Builds the theme for the resolved light/dark mode.
 *
 * `background` is a literal rather than a palette key on purpose: the chart sits
 * on the shell's `bg-background`, so the canvas and the DOM around it must be
 * the same colour or the pane shows a rectangle of VChart's own grey in dark
 * mode (its dark palette paints `#202226`, the app paints `#090b0c`).
 */
export function buildChartTheme(tokens: DataViewThemeTokens): ChartThemeVars {
  return {
    type: tokens.mode,
    background: tokens.background,
    fontFamily: resolveCanvasFontFamily(tokens),
    padding: CHART_FIXED.padding,
  };
}
