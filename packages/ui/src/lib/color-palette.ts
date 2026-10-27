// SPDX-License-Identifier: AGPL-3.0-only

import type { VisualConfig } from "@workspace/interfaces";

export interface ColorPickerColor {
  value: string;
  label?: string;
  /** Display color when the stored value is a token. */
  background?: string;
}

export interface ColorPickerGroup {
  label: string;
  colors: readonly ColorPickerColor[];
}

/** Six shades per family, from light to dark. */
export const COLOR_PICKER_GROUPS: readonly ColorPickerGroup[] = [
  {
    label: "灰",
    colors: ["#ffffff", "#e2e8f0", "#94a3b8", "#64748b", "#334155", "#000000"],
  },
  {
    label: "红",
    colors: ["#fee2e2", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#991b1b"],
  },
  {
    label: "橙",
    colors: ["#ffedd5", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#9a3412"],
  },
  {
    label: "黄",
    colors: ["#fef9c3", "#fde047", "#facc15", "#eab308", "#ca8a04", "#854d0e"],
  },
  {
    label: "绿",
    colors: ["#dcfce7", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#166534"],
  },
  {
    label: "青",
    colors: ["#ccfbf1", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#115e59"],
  },
  {
    label: "蓝",
    colors: ["#dbeafe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1e3a8a"],
  },
  {
    label: "紫",
    colors: ["#ede9fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#6366f1", "#5b21b6"],
  },
  {
    label: "粉",
    colors: ["#fce7f3", "#f9a8d4", "#f472b6", "#ec4899", "#db2777", "#9d174d"],
  },
].map((group) => ({
  ...group,
  colors: group.colors.map((value) => ({ value })),
}));

export type ColorTheme = "light" | "dark";

/** Match only a known six-shade family. Custom colors stay unchanged. */
export function resolveThemeColor(color: string, theme: ColorTheme): string {
  // The legacy grid default predates the palette; use its nearest pale gray.
  const value =
    color.toLowerCase() === "#e5e7eb" ? "#e2e8f0" : color.toLowerCase();
  for (const group of COLOR_PICKER_GROUPS) {
    const index = group.colors.findIndex((shade) => shade.value === value);
    if (index < 0) continue;
    const matches = theme === "dark" ? index >= 3 : index < 3;
    return matches
      ? group.colors[index]!.value
      : group.colors[5 - index]!.value;
  }
  return color;
}

/** Grid shades contrast with the theme: dark on light, light on dark. */
export function resolveGridThemeColor(
  color: string,
  theme: ColorTheme,
): string {
  return resolveThemeColor(color, theme === "light" ? "dark" : "light");
}

/** Read older records with separate flags as one shared preference. */
export function isViewColorSyncEnabled(config: VisualConfig = {}): boolean {
  const legacy = config as VisualConfig & {
    backgroundColorSyncTheme?: boolean;
    gridColorSyncTheme?: boolean;
  };
  return (
    config.colorsSyncTheme ??
    Boolean(legacy.backgroundColorSyncTheme || legacy.gridColorSyncTheme)
  );
}

/** Resolve locally so two clients can use different themes for the same view. */
export function resolveViewColors(
  config: VisualConfig = {},
  theme?: ColorTheme,
) {
  const backgroundColor = config.backgroundColor ?? "#ffffff";
  const gridColor = config.gridColor ?? "#e5e7eb";
  const synced = isViewColorSyncEnabled(config);
  return {
    backgroundColor:
      theme && synced
        ? resolveThemeColor(backgroundColor, theme)
        : backgroundColor,
    gridColor:
      theme && synced ? resolveGridThemeColor(gridColor, theme) : gridColor,
  };
}
