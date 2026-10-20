// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * Maps the shared data-view theme tokens onto VTable's `ITableThemeDefine`.
 *
 * Canvas engines cannot resolve CSS variables, so this is the one place literal
 * colors are handed to VTable (see `shared/theme-tokens.ts`).
 *
 * House rules for the grid (they mirror the HTML chrome):
 * - hairline rules only, and only horizontal ones — no spreadsheet box grid;
 * - the header is a muted band, the row-number column a muted lane;
 * - `primary` appears exactly twice: the 2px selection border and the resize
 *   guide. Everything else is neutral.
 *
 * See `docs/dataview/table.md` §8.5.
 */
import type { TYPES } from "@visactor/vtable";

import {
  resolveCanvasFontFamily,
  type DataViewThemeTokens,
} from "../../../shared/theme-tokens";

/** Translucent variant of a `#rrggbb` color, falling back to the raw value. */
function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = parseInt(match[1]!, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * `[top, right, bottom, left]` line widths. Only the bottom rule is drawn, so
 * rows read as a list; the outer frame is left to the surrounding shell.
 */
const HAIRLINE_BOTTOM = [0, 0, 1, 0];

/** The VTable theme for the current data-view tokens. */
export function buildTableTheme(
  tokens: DataViewThemeTokens,
): TYPES.ITableThemeDefine {
  const hoverFill = withAlpha(tokens.foreground, 0.04);
  const headerHoverFill = withAlpha(tokens.foreground, 0.08);
  const cellPadding = [7, 10];
  const fontFamily = resolveCanvasFontFamily(tokens);

  return {
    underlayBackgroundColor: tokens.background,
    defaultStyle: {
      color: tokens.foreground,
      bgColor: tokens.background,
      fontSize: tokens.fontSize,
      fontFamily,
      borderColor: tokens.border,
      borderLineWidth: HAIRLINE_BOTTOM,
      padding: cellPadding,
    },
    headerStyle: {
      // Field names are chrome, not data: they sit a step below the cell text
      // and let the row content keep the contrast.
      color: tokens.mutedForeground,
      bgColor: tokens.muted,
      fontSize: tokens.fontSize,
      fontWeight: 500,
      fontFamily,
      borderColor: tokens.border,
      borderLineWidth: HAIRLINE_BOTTOM,
      padding: cellPadding,
      hover: { cellBgColor: headerHoverFill },
    },
    rowHeaderStyle: {
      color: tokens.mutedForeground,
      bgColor: tokens.muted,
      fontSize: tokens.fontSize,
      fontFamily,
      // The row-number lane is separated vertically, not horizontally.
      borderColor: tokens.border,
      borderLineWidth: [0, 1, 0, 0],
      padding: [7, 4],
      hover: { cellBgColor: headerHoverFill },
    },
    cornerHeaderStyle: {
      bgColor: tokens.muted,
      borderColor: tokens.border,
      borderLineWidth: [0, 1, 1, 0],
    },
    bodyStyle: {
      color: tokens.foreground,
      bgColor: tokens.background,
      fontSize: tokens.fontSize,
      fontFamily,
      borderColor: tokens.border,
      borderLineWidth: HAIRLINE_BOTTOM,
      padding: cellPadding,
      hover: { cellBgColor: hoverFill },
    },
    // The built-in checkbox is the one place VTable's own default (a solid
    // blue tick on a white square) is loud enough to fight the palette, so it
    // is re-tinted here instead of via the column style.
    checkboxStyle: {
      size: 14,
      defaultFill: tokens.background,
      defaultStroke: tokens.mutedForeground,
      checkedFill: tokens.primary,
      checkedStroke: tokens.primary,
      disableFill: tokens.muted,
      disableCheckedFill: withAlpha(tokens.primary, 0.5),
      disableCheckedStroke: withAlpha(tokens.primary, 0.5),
    },
    functionalIconsStyle: {
      sort_color: tokens.mutedForeground,
      sort_color_opacity: "0.55",
      sort_color_2: tokens.primary,
      sort_color_opacity_2: "1",
      sort_size: 12,
      frozen_color: tokens.mutedForeground,
      frozen_color_opacity: "0.5",
    },
    frameStyle: {
      borderColor: tokens.border,
      borderLineWidth: 0,
      shadowBlur: 0,
    },
    selectionStyle: {
      cellBorderColor: tokens.primary,
      cellBorderLineWidth: 2,
      cellBgColor: tokens.selection,
      inlineRowBgColor: tokens.selection,
      inlineColumnBgColor: tokens.selection,
    },
    frozenColumnLine: {
      shadow: {
        width: 4,
        startColor: withAlpha(tokens.foreground, 0.08),
        endColor: "transparent",
      },
    },
    scrollStyle: {
      visible: "scrolling",
      scrollSliderColor: withAlpha(tokens.foreground, 0.28),
      scrollRailColor: "transparent",
      width: 8,
      hoverOn: true,
    },
    tooltipStyle: {
      bgColor: tokens.foreground,
      color: tokens.background,
      fontSize: tokens.fontSize,
      padding: [6, 8],
    },
    columnResize: {
      visibleOnHover: true,
      lineColor: tokens.primary,
      bgColor: tokens.muted,
      lineWidth: 2,
    },
    groupTitleStyle: {
      color: tokens.foreground,
      bgColor: tokens.muted,
      fontSize: tokens.fontSize,
      fontWeight: 500,
      fontFamily,
      borderColor: tokens.border,
      borderLineWidth: HAIRLINE_BOTTOM,
      padding: [6, 10],
    },
  };
}
