// SPDX-License-Identifier: AGPL-3.0-only

/** Legacy tokens retain their theme-aware appearance in existing annotations. */
export const LEGACY_ANNOTATION_COLORS = {
  red: "#ef4444",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  ink: "#334155",
} as const;

/** Palette colors stay token-based in persisted strokes and brush preferences. */
export type AnnotationColorKey =
  | keyof typeof LEGACY_ANNOTATION_COLORS
  | `palette:${string}`;

const PALETTE_TOKEN = /^palette:([0-9a-f]{6})$/i;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isAnnotationColor(value: unknown): value is AnnotationColorKey {
  return (
    typeof value === "string" &&
    (Object.hasOwn(LEGACY_ANNOTATION_COLORS, value) ||
      PALETTE_TOKEN.test(value))
  );
}

export function annotationColorFromHex(
  value: string,
): AnnotationColorKey | undefined {
  return HEX_COLOR.test(value)
    ? `palette:${value.slice(1).toLowerCase()}`
    : undefined;
}

/** Only palette tokens resolve directly; legacy tokens still use CSS variables. */
export function annotationPaletteHex(value: string): string | undefined {
  const match = PALETTE_TOKEN.exec(value);
  return match ? `#${match[1]!.toLowerCase()}` : undefined;
}

/** Locate an existing legacy color's family when the full palette opens. */
export function annotationPickerValue(value: AnnotationColorKey): string {
  return (
    annotationPaletteHex(value) ??
    LEGACY_ANNOTATION_COLORS[value as keyof typeof LEGACY_ANNOTATION_COLORS]
  );
}
