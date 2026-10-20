// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useTheme } from "next-themes";
import type { VisualConfig } from "@workspace/interfaces";
import {
  isViewColorSyncEnabled,
  resolveViewColors,
} from "@workspace/ui/lib/color-palette";

export function useViewColors(config?: VisualConfig) {
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" | undefined =
    resolvedTheme === "light" || resolvedTheme === "dark"
      ? resolvedTheme
      : undefined;
  return {
    ...resolveViewColors(config, theme),
    theme,
    colorsSyncTheme: isViewColorSyncEnabled(config),
  } as const;
}
