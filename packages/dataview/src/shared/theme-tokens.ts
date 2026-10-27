// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useTheme } from "next-themes";

/**
 * Theme tokens third-party renderers map onto their own theme objects
 * (VTable theme, FullCalendar CSS variables, VChart theme, …).
 *
 * Values are literal CSS colors rather than `var(--token)` references because
 * canvas engines (VTable, VChart) cannot resolve CSS variables themselves.
 *
 * The literals mirror `@workspace/ui`'s `globals.css` tokens (base color
 * *mist* + the warm `--primary`), so a canvas renderer sits in the app's
 * palette instead of a generic grey one. `primary` is intentionally scarce:
 * renderers should spend it on state the user has engaged (selection, focus,
 * an active sort) and on nothing else.
 */
export interface DataViewThemeTokens {
  mode: "light" | "dark";
  background: string;
  foreground: string;
  border: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  primary: string;
  primaryForeground: string;
  /** Translucent fill for a selected row / cell. */
  selection: string;
  danger: string;
  /** `"inherit"` means "ask the DOM" — see {@link resolveCanvasFontFamily}. */
  fontFamily: string;
  fontSize: number;
  rowHeight: number;
}

const FALLBACK_FONT = "system-ui, -apple-system, sans-serif";

const LIGHT_TOKENS: DataViewThemeTokens = {
  mode: "light",
  background: "#ffffff",
  foreground: "#090b0c",
  border: "#e3e7e8",
  muted: "#f1f3f3",
  mutedForeground: "#67787c",
  accent: "#f1f3f3",
  accentForeground: "#161b1d",
  primary: "#bb4d00",
  primaryForeground: "#fffbeb",
  selection: "rgba(187, 77, 0, 0.07)",
  danger: "#e7000b",
  fontFamily: "inherit",
  fontSize: 12,
  rowHeight: 32,
};

const DARK_TOKENS: DataViewThemeTokens = {
  mode: "dark",
  background: "#090b0c",
  foreground: "#f9fbfb",
  border: "#232a2c",
  muted: "#22292b",
  mutedForeground: "#9ca8ab",
  accent: "#22292b",
  accentForeground: "#f9fbfb",
  // Brightened from the app's dark `--primary` (#973c00): a canvas needs the
  // accent to read against a near-black background — a 2px selection border at
  // the token's own lightness is nearly invisible.
  primary: "#e38150",
  primaryForeground: "#161b1d",
  selection: "rgba(227, 129, 80, 0.16)",
  danger: "#ff6467",
  fontFamily: "inherit",
  fontSize: 12,
  rowHeight: 32,
};

/** Resolves literal tokens from a concrete mode. */
export function getDataViewThemeTokens(
  mode: "light" | "dark",
): DataViewThemeTokens {
  return mode === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
}

/**
 * Resolves tokens for a view config `theme` value: `auto` follows
 * `next-themes`, anything else is taken at face value.
 */
export function useDataViewThemeTokens(
  theme: "light" | "dark" | "auto" = "auto",
): DataViewThemeTokens {
  const { resolvedTheme } = useTheme();
  const mode =
    theme === "auto" ? (resolvedTheme === "dark" ? "dark" : "light") : theme;
  return getDataViewThemeTokens(mode);
}

/**
 * The font stack a canvas renderer should draw with.
 *
 * `fontFamily: "inherit"` is meaningless to a canvas context — VTable builds a
 * CSS font shorthand out of the token, `12px inherit` does not parse, and the
 * context silently keeps whatever font it had. Reading the *computed* stack off
 * `<body>` yields the real (hashed) `next/font` family names, so canvas text
 * matches the HTML around it.
 */
export function resolveCanvasFontFamily(tokens: DataViewThemeTokens): string {
  if (tokens.fontFamily !== "inherit") return tokens.fontFamily;
  if (typeof window === "undefined") return FALLBACK_FONT;
  const computed = window.getComputedStyle(document.body).fontFamily.trim();
  return computed || FALLBACK_FONT;
}
