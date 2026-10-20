// SPDX-License-Identifier: AGPL-3.0-only

/**
 * 单选 / 多选 cells as colour capsules (胶囊).
 *
 * A select-ish cell is drawn with VTable's low-level `customRender` element API
 * instead of plain text: one rounded `rect` + one `text` per option, filled with
 * the option's own colour and a derived contrasting text colour — the same
 * treatment a 填色 fill gets, so both stay readable in either theme.
 *
 * The record a cell renders from carries only option *names* (`cellToRecordValue`)
 * because those are what the dropdown edits and what search matches; the raw
 * option ids therefore travel beside them under {@link optionIdsKey}, which is
 * what resolves an option's colour without guessing from its label.
 *
 * **The active cell is interactive, and the interactivity is drawn on the
 * canvas.** Once the user has clicked a capsule cell, every capsule gains a
 * trailing `×` and the cell gains a chevron at its right edge. Both are emitted
 * as VTable `icon` elements carrying a `name`: VTable turns those into pickable
 * graphics with `role: "icon-custom"`, and a tap on one is reported back as the
 * table's `icon_click` event (`table-data-view.tsx`) — so the hit target is
 * VTable's own scene graph, not arithmetic on a canvas rect.
 *
 * Everything here is pure and dependency-free (canvas text metrics are the only
 * ambient API, with a deterministic fallback when there is no DOM).
 */
import type { DatabaseField } from "@workspace/interfaces";

import { contrastTextColor } from "../../../shared/color";
import { resolveOptionColor } from "../../../shared/field-meta";

/** Record key prefix carrying a select-ish cell's raw option ids. */
const OPTION_IDS_PREFIX = "__optionIds_";

/** The record key a field's option ids are stored under. */
export function optionIdsKey(fieldId: string): string {
  return `${OPTION_IDS_PREFIX}${fieldId}`;
}

/**
 * `icon_click` name of the "×" inside a capsule.
 *
 * The option id is carried in the name because the icon element is the only
 * thing VTable hands back with the event.
 */
export const PILL_REMOVE_ICON_PREFIX = "dv_pill_remove:";

/** `icon_click` name of the cell-end chevron that opens the option dropdown. */
export const PILL_OPEN_ICON = "dv_pill_open";

/** The canvas font a cell is painted with (from the resolved theme tokens). */
export interface PillFont {
  family: string;
  size: number;
}

/** The subset of VTable's render element shape this module emits. */
export interface PillShapeElement {
  type: "rect" | "text";
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  fill?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: "left" | "center" | "right";
  textBaseline?: "top" | "middle" | "bottom";
}

/**
 * A clickable glyph.
 *
 * `clickable` is what makes VTable mark the graphic pickable; `name` is what its
 * `icon_click` event reports back.
 */
export interface PillIconElement {
  type: "icon";
  x: number;
  y: number;
  width: number;
  height: number;
  svg: string;
  name: string;
  clickable: true;
  cursor: "pointer";
}

export type PillElement = PillShapeElement | PillIconElement;

export interface OptionPillInput {
  field: DatabaseField;
  /** Raw option ids, in cell order. */
  optionIds: readonly string[];
  /** The cell rect VTable hands `customRender`. */
  width: number;
  height: number;
  font: PillFont;
  /**
   * Draw each capsule with a trailing "×" that removes that one option
   * (the cell is the one the user activated).
   */
  removable?: boolean;
  /** Draw the cell-end chevron that opens the option dropdown. */
  showChevron?: boolean;
  /** Glyph colour of the chevron — the theme's muted foreground. */
  chevronColor?: string;
}

export interface OptionPillResult {
  elements: PillElement[];
  /** Option ids that did not fit (reported as a trailing +N chip). */
  hidden: number;
}

// —— text metrics ——————————————————————————————————————————————————————————

const measureCache = new Map<string, number>();
let measureContext: CanvasRenderingContext2D | null | undefined;

function canvasContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  }
  return measureContext;
}

/**
 * Width of `text` at `font`, memoized per (font, text).
 *
 * VTable paints on a canvas and offers no measurement hook inside
 * `customRender`, so the capsule has to size itself — an offscreen 2D context is
 * the only reliable measure. Without a DOM (SSR / tests) a fixed average glyph
 * width keeps the layout sane instead of returning 0.
 */
export function measurePillText(text: string, font: PillFont): number {
  const key = `${font.size}|${font.family}|${text}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;
  const context = canvasContext();
  let width: number;
  if (context) {
    context.font = `${font.size}px ${font.family}`;
    width = context.measureText(text).width;
  } else {
    width = text.length * font.size * 0.62;
  }
  // CJK glyphs are ~1em wide; a cache per distinct label stays tiny.
  if (measureCache.size > 2000) measureCache.clear();
  measureCache.set(key, width);
  return width;
}

// —— glyphs ————————————————————————————————————————————————————————————————

/**
 * VTable paints a custom-render icon from an SVG *string*, so the glyph's
 * colour has to be baked into the markup. Both colours below are derived (the
 * capsule's contrast colour, the theme's muted foreground) but a persisted
 * option colour is user data, so it is pattern-checked before it is interpolated
 * — the string ends up in the scene graph's image attribute.
 */
function sanitizeSvgColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  return /^[#a-zA-Z0-9(),.\s%-]+$/.test(trimmed) ? trimmed : fallback;
}

const glyphCache = new Map<string, string>();

function glyph(key: string, build: () => string): string {
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const svg = build();
  // A handful of distinct colours per theme; the cap only guards a pathological
  // option palette.
  if (glyphCache.size > 256) glyphCache.clear();
  glyphCache.set(key, svg);
  return svg;
}

/** The "×" a capsule shows while its cell is active. */
function crossSvg(color: string): string {
  return glyph(`cross:${color}`, () => {
    const stroke = sanitizeSvgColor(color, "#111827");
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 5l6 6M11 5l-6 6" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  });
}

/** The chevron at the active cell's right edge. */
function chevronSvg(color: string): string {
  return glyph(`chevron:${color}`, () => {
    const stroke = sanitizeSvgColor(color, "#6b7280");
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 6.5L8 10l3.5-3.5" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  });
}

// —— capsule layout ————————————————————————————————————————————————————————

/** Horizontal padding inside a capsule, and the gap between two of them. */
const PILL_PADDING_X = 7;
const PILL_GAP = 4;
/** Vertical breathing room between the capsule and the row's border. */
const PILL_MARGIN_Y = 4;
/** Space the trailing "+N" chip needs before it is worth drawing. */
const OVERFLOW_CHIP_WIDTH = 22;
/** Gap between a capsule's label and its "×". */
const PILL_ICON_GAP = 4;
/** Padding between a capsule's "×" and the capsule's right edge. */
const PILL_ICON_PADDING = 3;
/** Side of the "×" / chevron glyph box (the drawn glyph is inset inside it). */
const GLYPH_SIZE = 14;
/** Distance the chevron keeps from the cell's right edge. */
const CHEVRON_RIGHT = 5;

/**
 * The capsules for one select-ish cell.
 *
 * Returns the element list for VTable plus how many options did not fit; the
 * caller decides whether the cell is "empty" (nothing to draw at all). An empty
 * active cell still returns the chevron, on its own, so the dropdown stays
 * reachable.
 */
export function buildOptionPills({
  field,
  optionIds,
  width,
  height,
  font,
  removable = false,
  showChevron = false,
  chevronColor,
}: OptionPillInput): OptionPillResult {
  const options = field.options ?? [];
  const resolved = optionIds
    .map((optionId, index) => {
      const option = options.find((entry) => entry.id === optionId);
      if (!option) return null;
      return {
        id: option.id,
        name: option.name || optionId,
        color: resolveOptionColor(option, index),
      };
    })
    .filter(
      (entry): entry is { id: string; name: string; color: string } =>
        entry !== null,
    );

  const pillHeight = Math.max(
    16,
    Math.min(font.size + 8, Math.max(16, height - PILL_MARGIN_Y * 2)),
  );
  const pillY = Math.max(0, (height - pillHeight) / 2);
  const glyphSize = Math.max(12, Math.min(GLYPH_SIZE, pillHeight));
  const elements: PillElement[] = [];

  if (showChevron) {
    elements.push({
      type: "icon",
      x: Math.max(0, width - CHEVRON_RIGHT - glyphSize),
      y: Math.max(0, (height - glyphSize) / 2),
      width: glyphSize,
      height: glyphSize,
      svg: chevronSvg(chevronColor ?? ""),
      name: PILL_OPEN_ICON,
      clickable: true,
      cursor: "pointer",
    });
  }

  if (resolved.length === 0) return { elements, hidden: 0 };

  // The chevron owns the right edge; the capsules get what is left of it.
  const reserved = showChevron ? CHEVRON_RIGHT + glyphSize + PILL_ICON_GAP : 2;
  const budget = Math.max(0, width - reserved);
  // The chevron is drawn first so a capsule covering it cannot hide it, but it
  // must stay the *last* element of the returned list (painter's order).
  const chevronElement = elements.pop();

  let cursor = 1;
  let hidden = 0;
  for (let index = 0; index < resolved.length; index += 1) {
    const pill = resolved[index]!;
    const textWidth = measurePillText(pill.name, font);
    const trailing = removable
      ? PILL_ICON_GAP + glyphSize + PILL_ICON_PADDING
      : PILL_PADDING_X;
    const pillWidth = textWidth + PILL_PADDING_X + trailing;
    const rest = resolved.length - index - 1;
    const overflow = rest > 0 ? OVERFLOW_CHIP_WIDTH : 0;
    if (cursor + pillWidth + overflow > budget) {
      hidden = resolved.length - index;
      break;
    }
    elements.push({
      type: "rect",
      x: cursor,
      y: pillY,
      width: pillWidth,
      height: pillHeight,
      radius: pillHeight / 2,
      fill: pill.color,
    });
    elements.push({
      type: "text",
      x: cursor + PILL_PADDING_X,
      y: pillY + pillHeight / 2,
      text: pill.name,
      fill: contrastTextColor(pill.color),
      fontSize: font.size,
      fontFamily: font.family,
      textAlign: "left",
      textBaseline: "middle",
    });
    if (removable) {
      elements.push({
        type: "icon",
        x: cursor + pillWidth - PILL_ICON_PADDING - glyphSize,
        y: pillY + (pillHeight - glyphSize) / 2,
        width: glyphSize,
        height: glyphSize,
        svg: crossSvg(contrastTextColor(pill.color)),
        name: `${PILL_REMOVE_ICON_PREFIX}${pill.id}`,
        clickable: true,
        cursor: "pointer",
      });
    }
    cursor += pillWidth + PILL_GAP;
  }

  if (hidden > 0 && cursor + OVERFLOW_CHIP_WIDTH <= budget + PILL_GAP) {
    elements.push({
      type: "text",
      x: cursor,
      y: pillY + pillHeight / 2,
      text: `+${hidden}`,
      fill: "#6b7280",
      fontSize: font.size,
      fontFamily: font.family,
      textAlign: "left",
      textBaseline: "middle",
    });
  }

  // The chevron goes back on top of everything the cell draws.
  if (chevronElement) elements.push(chevronElement);

  return { elements, hidden };
}
