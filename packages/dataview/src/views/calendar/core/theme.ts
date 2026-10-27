// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The workspace's theme tokens mapped onto FullCalendar's CSS custom properties.
 *
 * FullCalendar v6 styles itself through `--fc-*` variables, so the calendar can
 * sit in the app's palette without forking its stylesheet: the shell puts the
 * returned record on the calendar's own wrapper element, and every `--fc-*`
 * lookup inside the widget resolves there.
 *
 * Pure module: no React, no third-party library — the caller supplies the
 * tokens (`shared/theme-tokens.ts`), which are literal colours precisely because
 * a library that cannot read CSS variables needs real values.
 */
import type { DataViewThemeTokens } from "../../../shared/theme-tokens";

/**
 * `--fc-*` overrides for one theme mode.
 *
 * The values follow the same rules as the rest of the app: `--primary` is spent
 * only on state the user engaged (today's cell, the drag highlight, a selected
 * event), the default event fill is a quiet primary tint rather than full
 * `--primary` — a month grid of saturated chips is unreadable — and coloured
 * events override `background-color` per event, so they never see this default.
 */
export function buildCalendarThemeVars(
  tokens: DataViewThemeTokens,
): Record<string, string> {
  const tintedEvent = `color-mix(in oklab, ${tokens.primary} 16%, ${tokens.background})`;
  const tintedEventBorder = `color-mix(in oklab, ${tokens.primary} 38%, ${tokens.background})`;

  return {
    // —— frame ——
    "--fc-page-bg-color": tokens.background,
    "--fc-border-color": tokens.border,
    "--fc-neutral-bg-color": tokens.muted,
    "--fc-neutral-text-color": tokens.mutedForeground,
    "--fc-small-font-size": "0.75rem",
    "--fc-daygrid-event-dot-width": "8px",
    "--fc-list-event-dot-width": "8px",

    // —— engaged state (today / drag highlight / now line) ——
    "--fc-today-bg-color": tokens.selection,
    "--fc-highlight-color": tokens.selection,
    "--fc-now-indicator-color": tokens.danger,

    // —— default event chip (an event with no colour field) ——
    "--fc-event-bg-color": tintedEvent,
    "--fc-event-border-color": tintedEventBorder,
    "--fc-event-text-color": tokens.foreground,

    // —— "+N more" link ——
    "--fc-more-link-bg-color": tokens.muted,
    "--fc-more-link-text-color": tokens.foreground,

    // —— header buttons: chrome, so neutral; hover lifts to `accent` ——
    "--fc-button-bg-color": tokens.background,
    "--fc-button-border-color": tokens.border,
    "--fc-button-text-color": tokens.foreground,
    "--fc-button-hover-bg-color": tokens.accent,
    "--fc-button-hover-border-color": tokens.border,
    "--fc-button-active-bg-color": tokens.accent,
    "--fc-button-active-border-color": tokens.border,

    // —— list view ——
    "--fc-list-event-hover-bg-color": tokens.accent,
  };
}
