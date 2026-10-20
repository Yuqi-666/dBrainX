// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useEffect } from "react";
import type { SetStateAction } from "react";
import { BRUSHES } from "./brushes";
import type { BrushTool } from "./brushes";
import { DEFAULT_ANNOTATION_COLOR, DEFAULT_ANNOTATION_SIZE } from "./types";
import type { AnnotationColorKey, AnnotationTool } from "./types";
import { isAnnotationColor } from "./colors";
import { useToolbarPreference } from "./use-toolbar-preference";

type BrushSettings = { color: AnnotationColorKey; size: number };
type Settings = Partial<Record<BrushTool | "eraser", BrushSettings>>;
const isSize = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0.001 &&
  value <= 0.04;
const isSettings = (value: unknown): value is Settings => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  return Object.entries(value).every(
    ([key, item]) =>
      (key === "eraser" || BRUSHES.some((brush) => brush.tool === key)) &&
      typeof item === "object" &&
      item !== null &&
      isAnnotationColor(item.color) &&
      isSize(item.size),
  );
};

/** Each brush owns its settings; legacy shared preferences seed untouched brushes. */
export function useBrushSettings(tool: AnnotationTool) {
  const [legacyColor] = useToolbarPreference(
    "color",
    DEFAULT_ANNOTATION_COLOR,
    isAnnotationColor,
  );
  const [legacySize] = useToolbarPreference(
    "size",
    DEFAULT_ANNOTATION_SIZE,
    isSize,
  );
  const [settings, setSettings] = useToolbarPreference<Settings>(
    "brushSettings",
    {},
    isSettings,
  );
  const [lastBrush, setLastBrush] = useToolbarPreference<BrushTool>(
    "lastBrush",
    "pen",
    (value): value is BrushTool =>
      BRUSHES.some((brush) => brush.tool === value),
  );
  useEffect(() => {
    if (tool !== "pointer" && tool !== "eraser") setLastBrush(tool);
  }, [tool, setLastBrush]);
  const key = tool === "pointer" ? lastBrush : tool;
  const fallback = { color: legacyColor, size: legacySize };
  const current = settings[key] ?? fallback;
  const setColor = useCallback(
    (color: AnnotationColorKey) => {
      setSettings((all) => ({
        ...all,
        [key]: {
          ...(all[key] ?? { color: legacyColor, size: legacySize }),
          color,
        },
      }));
    },
    [key, legacyColor, legacySize, setSettings],
  );
  const setSize = useCallback(
    (value: SetStateAction<number>) => {
      setSettings((all) => {
        const previous = all[key] ?? { color: legacyColor, size: legacySize };
        const size = typeof value === "function" ? value(previous.size) : value;
        return { ...all, [key]: { ...previous, size } };
      });
    },
    [key, legacyColor, legacySize, setSettings],
  );
  return { ...current, setColor, setSize };
}
