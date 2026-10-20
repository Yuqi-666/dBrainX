// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * Maps the shared data-view theme tokens onto the colors VTable-Gantt paints
 * with.
 *
 * Canvas engines cannot resolve CSS variables, so this is the one place literal
 * colors are handed to the gantt (see `shared/theme-tokens.ts`). The house rules
 * are the table's, because the two views sit next to each other: hairline rules
 * only, a muted header band, and `primary` spent on exactly two things — the
 * **task bar** (the view's content) and the 今日线. The 分组 summary bar is
 * deliberately neutral (`foreground` at low alpha): a group is structure, not
 * progress.
 *
 * The task list panel is a real VTable `ListTable` underneath, so it gets an
 * `ITableThemeDefine` of its own — a leaner version of `views/table/canvas/`
 * `theme.ts` (one column, no row numbers, no frozen line, no checkbox).
 *
 * See `docs/dataview/gantt.md` §0.
 */
import type { TYPES } from "@visactor/vtable";

import { tintColor } from "../../../shared/color";
import {
  resolveCanvasFontFamily,
  type DataViewThemeTokens,
} from "../../../shared/theme-tokens";

/** Translucent variant of a color, falling back to the raw value. */
function withAlpha(color: string, alpha: number): string {
  return tintColor(color, alpha) ?? color;
}

/** The theme pieces the gantt surface reads (all literal colors). */
export interface GanttTheme {
  background: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  muted: string;
  primary: string;
  fontFamily: string;
  fontSize: number;
  /** The left task-list panel's VTable theme. */
  taskListTheme: TYPES.ITableThemeDefine;
  /** Both scrollbars of the surface, themed like the table's. */
  scrollStyle: TYPES.ScrollStyle;
  /** The task bar: a wash of `primary`, with the completed part solid. */
  barColor: string;
  completedBarColor: string;
  /** The 分组 summary bar — neutral, because a group is not progress. */
  groupBarColor: string;
  /** A bar's label, drawn outside the bar so it never fights the fill. */
  labelColor: string;
  /** The translucent wash a hovered bar wears. */
  hoverOverlayColor: string;
  weekendBackgroundColor: string;
  /** The 今日线 and its little pill. */
  markLineColor: string;
  markLineTextColor: string;
}

/** The VTable theme for the task list panel, in the current tokens. */
function buildTaskListTheme(
  tokens: DataViewThemeTokens,
): TYPES.ITableThemeDefine {
  const fontFamily = resolveCanvasFontFamily(tokens);
  const hoverFill = withAlpha(tokens.foreground, 0.04);
  const hairlineBottom = [0, 0, 1, 0];

  return {
    underlayBackgroundColor: tokens.background,
    defaultStyle: {
      color: tokens.foreground,
      bgColor: tokens.background,
      fontSize: tokens.fontSize,
      fontFamily,
      borderColor: tokens.border,
      borderLineWidth: hairlineBottom,
      padding: [6, 8],
    },
    headerStyle: {
      // The panel's own header is the timeline's header band — it must line up
      // with the date rows above the timeline, so it uses the same muted fill.
      color: tokens.mutedForeground,
      bgColor: tokens.muted,
      fontSize: tokens.fontSize,
      fontWeight: 500,
      fontFamily,
      borderColor: tokens.border,
      borderLineWidth: hairlineBottom,
      padding: [6, 8],
    },
    bodyStyle: {
      color: tokens.foreground,
      bgColor: tokens.background,
      fontSize: tokens.fontSize,
      fontFamily,
      borderColor: tokens.border,
      borderLineWidth: hairlineBottom,
      padding: [6, 8],
      hover: { cellBgColor: hoverFill },
    },
    frameStyle: {
      borderColor: tokens.border,
      borderLineWidth: 0,
      shadowBlur: 0,
    },
    scrollStyle: {
      visible: "scrolling",
      scrollSliderColor: withAlpha(tokens.foreground, 0.28),
      scrollRailColor: "transparent",
      width: 8,
      hoverOn: true,
    },
  };
}

/** The gantt theme for the current data-view tokens. */
export function buildGanttTheme(tokens: DataViewThemeTokens): GanttTheme {
  return {
    background: tokens.background,
    border: tokens.border,
    foreground: tokens.foreground,
    mutedForeground: tokens.mutedForeground,
    muted: tokens.muted,
    primary: tokens.primary,
    fontFamily: resolveCanvasFontFamily(tokens),
    fontSize: tokens.fontSize,
    taskListTheme: buildTaskListTheme(tokens),
    scrollStyle: {
      visible: "scrolling",
      scrollSliderColor: withAlpha(tokens.foreground, 0.28),
      scrollRailColor: "transparent",
      width: 8,
      hoverOn: true,
    },
    // A 28% wash keeps the bar visibly *ours* while letting the task name sit
    // outside it in the normal text color (below).
    barColor: withAlpha(tokens.primary, 0.28),
    completedBarColor: tokens.primary,
    groupBarColor: withAlpha(tokens.foreground, 0.35),
    labelColor: tokens.foreground,
    hoverOverlayColor: withAlpha(tokens.foreground, 0.06),
    weekendBackgroundColor: tokens.muted,
    markLineColor: tokens.primary,
    markLineTextColor: tokens.background,
  };
}
