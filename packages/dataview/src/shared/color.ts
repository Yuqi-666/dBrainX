// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Colour maths shared by every view that paints a colour into a place that
 * cannot inherit the theme's text colour.
 *
 * A 填色 rule, a 单选/多选 capsule (canvas) and a calendar event all set only a
 * *background*: the text on top keeps coming from the theme, and a pale fill
 * under light-on-dark text (or a saturated fill under dark-on-light) is
 * unreadable. Each of those call sites therefore pairs its fill with
 * `contrastTextColor(fill)`.
 *
 * Pure module: no React, no third-party library, no DOM.
 */

/** Text colour a colour-filled surface falls back to when the fill is unreadable. */
const DARK_TEXT = "#111827";
const LIGHT_TEXT = "#f8fafc";

/** WCAG relative luminance of one 0-255 sRGB channel. */
function channelLuminance(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(red: number, green: number, blue: number): number {
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

/** `#rrggbb` / `rrggbb` → 0-255 channels, or `null`. */
function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** `hsl(H S% L%)` → 0-255 channels, or `null`. */
function parseHsl(value: string): [number, number, number] | null {
  const match =
    /^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%/i.exec(
      value.trim(),
    );
  if (!match) return null;
  const hue = ((parseFloat(match[1]!) % 360) + 360) % 360;
  const saturation = parseFloat(match[2]!) / 100;
  const lightness = parseFloat(match[3]!) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const [red, green, blue] =
    hue < 60
      ? [chroma, secondary, 0]
      : hue < 120
        ? [secondary, chroma, 0]
        : hue < 180
          ? [0, chroma, secondary]
          : hue < 240
            ? [0, secondary, chroma]
            : hue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return [
    Math.round((red + offset) * 255),
    Math.round((green + offset) * 255),
    Math.round((blue + offset) * 255),
  ];
}

/**
 * A readable text colour for a colour-filled surface.
 *
 * Understands the two shapes this package produces — hex (the option / 填色
 * palettes) and `hsl(...)` (the deterministic fallback `CellResolver.toColor`
 * mints for an option that never declared a colour) — and degrades to dark text
 * for anything else (a theme variable, a keyword), which is the safer default on
 * the app's light surfaces.
 */
export function contrastTextColor(background: string): string {
  const rgb = parseHex(background) ?? parseHsl(background);
  if (!rgb) return DARK_TEXT;
  const luminance = relativeLuminance(rgb[0], rgb[1], rgb[2]);
  return luminance > 0.5 ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * The same colour as a translucent wash, for a surface that sits *on* a themed
 * background instead of replacing it.
 *
 * A card chip wants to be recognisable by hue without shouting: a ~20% wash of
 * the option colour over `--card` keeps the theme's own text colour readable in
 * either mode, which a solid fill (the canvas capsule's job, where the text
 * colour is computed from the fill) cannot promise. Returns `undefined` for a
 * colour this module cannot parse, so the caller keeps its neutral surface
 * rather than painting an opaque guess.
 */
export function tintColor(color: string, alpha: number): string | undefined {
  const rgb = parseHex(color) ?? parseHsl(color);
  if (!rgb) return undefined;
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamped})`;
}
