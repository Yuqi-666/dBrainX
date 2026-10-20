// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Replaying annotations onto a canvas — the `perfect-freehand` wrapper and the
 * five item renderers. **No React, no DOM lookups, no state**: design §5.3 needs
 * this to be reusable for the P2 PNG bake (same functions, same normalized
 * coordinates, a different rectangle), and `draw.test.ts` needs it to be callable
 * with a recording stub.
 *
 * ## Coordinate convention
 *
 * Every function here draws in the **base rectangle's own pixel space**: the
 * origin is the rectangle's top-left, and a normalized point `(u, v)` becomes
 * `(u × rect.width, v × rect.height)`. The caller is responsible for two things
 * before calling in:
 *
 * 1. translating the context so the rectangle's top-left is `(0, 0)` — the ink
 *    canvas is positioned exactly over the base rectangle, so this is free;
 * 2. scaling by `devicePixelRatio` (`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`) —
 *    otherwise the ink is drawn at CSS resolution into a device-pixel backing
 *    store and comes out blurry (design §0.3-6).
 *
 * Sizes are stored as a fraction of the **short edge** (design §0.2-②) and turned
 * into pixels by `toDisplaySize`; nothing in this file knows or cares which
 * device wrote the data.
 *
 * Colours arrive through a {@link ColorResolver}: an item stores a **token key**
 * (`"red"`), and resolving it to an actual colour needs the theme — which is a
 * DOM question (`getComputedStyle`) and so belongs to the canvas, not here.
 */
import { getStroke } from "perfect-freehand";
import type {
  Annotation,
  AnnotationPoint,
  ArrowAnno,
  Highlight,
  ShapeAnno,
  Stroke,
  TextAnno,
} from "@workspace/interfaces";

import type { BaseRect } from "./types";

/**
 * A normalized size (fraction of the base rectangle's short edge) → pixels.
 *
 * Deliberately local rather than imported from `geometry.ts`: this module is
 * loaded by `node --test`, which resolves a relative specifier literally, and a
 * value import of a sibling `.ts` file would need a `.ts` extension in the
 * specifier. `draw.test.ts` pins the pixel result and `geometry.test.ts` pins the
 * formula, so the two cannot drift apart unnoticed.
 */
function toDisplaySize(size: number, rect: BaseRect): number {
  return size * Math.min(rect.width, rect.height);
}

/** Resolves a stored colour token key to a CSS colour (`"oklch(…)"`). */
export type ColorResolver = (key: string) => string;

/**
 * The subset of `CanvasRenderingContext2D` this module touches.
 *
 * Declared structurally for one reason: the drawing can then be executed by a
 * recording stub in `draw.test.ts`, which is the only way a shape's geometry gets
 * an assertion without a browser. A real 2D context satisfies it unchanged.
 */
export interface InkContext {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
}

/** The four `perfect-freehand` knobs an item carries, plus its nib. */
export interface StrokeStyle {
  /** Normalized (fraction of the short edge). */
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  simulatePressure: boolean;
}

/**
 * The line height the canvas uses for multi-line text, as a multiple of the font
 * size. M7's DOM text layer has to use the same number or the same text will be a
 * different height in the two renderers (design §3.4 last paragraph).
 */
export const TEXT_LINE_HEIGHT = 1.3;

const TEXT_FONT_FAMILY = "system-ui, ui-sans-serif, sans-serif";

/**
 * Normalized points → the px outline polygon of a tapered stroke.
 *
 * `getStroke` is fed **pixel** coordinates and asked for a **pixel** size — the
 * normalized form is a storage detail (design §3.2's warning). Pressure is passed
 * per point only when the input actually produced one; otherwise
 * `simulatePressure` (decided once per stroke, design §4.5) asks the library to
 * derive it from velocity.
 */
export function strokeOutline(
  points: readonly AnnotationPoint[],
  rect: BaseRect,
  style: StrokeStyle,
): number[][] {
  if (points.length === 0) return [];

  const input = points.map((point) => {
    const row: number[] = [point.x * rect.width, point.y * rect.height];
    if (point.p !== undefined) row.push(point.p);
    return row;
  });

  return getStroke(input, {
    size: toDisplaySize(style.size, rect),
    thinning: style.thinning,
    smoothing: style.smoothing,
    streamline: style.streamline,
    simulatePressure: style.simulatePressure,
    last: true,
  });
}

function fillOutline(
  ctx: InkContext,
  outline: readonly number[][],
  color: string,
  opacity: number,
  blend?: GlobalCompositeOperation,
): void {
  if (outline.length < 3) return;

  ctx.save();
  if (opacity !== 1) ctx.globalAlpha = opacity;
  if (blend) ctx.globalCompositeOperation = blend;
  ctx.fillStyle = color;
  ctx.beginPath();
  const first = outline[0]!;
  ctx.moveTo(first[0]!, first[1]!);
  for (let i = 1; i < outline.length; i += 1) {
    const point = outline[i]!;
    ctx.lineTo(point[0]!, point[1]!);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStroke(
  ctx: InkContext,
  item: Stroke,
  rect: BaseRect,
  color: string,
): void {
  const outline = strokeOutline(item.points, rect, {
    size: item.size,
    thinning: item.thinning,
    smoothing: item.smoothing,
    streamline: item.streamline,
    simulatePressure: item.simulatePressure,
  });
  if (item.brush === "pencil") {
    drawGraphite(ctx, outline, rect, color, item.opacity);
  } else {
    fillOutline(ctx, outline, color, item.opacity);
  }
}

/** Grain is anchored to paper coordinates, so replay and zoom never randomize it.
 * Scanline spans keep the work proportional to ink area, not its bounding box.
 */
function drawGraphite(
  ctx: InkContext,
  outline: readonly number[][],
  rect: BaseRect,
  color: string,
  opacity: number,
): void {
  if (outline.length < 3) return;
  const grain = Math.min(rect.width, rect.height) / 650;
  const minY = outline.reduce((min, p) => Math.min(min, p[1]!), Infinity);
  const maxY = outline.reduce((max, p) => Math.max(max, p[1]!), -Infinity);
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  ctx.beginPath();
  for (let row = Math.floor(minY / grain); row * grain < maxY; row++) {
    const y = (row + 0.5) * grain;
    const crossings: number[] = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!;
      const b = outline[(i + 1) % outline.length]!;
      if (a[1]! > y === b[1]! > y) continue;
      crossings.push(a[0]! + ((y - a[1]!) / (b[1]! - a[1]!)) * (b[0]! - a[0]!));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = crossings[i]!;
      const right = crossings[i + 1]!;
      for (
        let col = Math.ceil(left / grain);
        (col + 1) * grain < right;
        col++
      ) {
        let hash = Math.imul(col, 374761393) ^ Math.imul(row, 668265263);
        hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
        const noise = ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
        if (noise < 0.22) continue;
        const dot = grain * (0.3 + noise * 0.65);
        ctx.rect((col + noise * 0.25) * grain, y - dot / 2, dot, dot);
      }
    }
  }
  ctx.fill();
  ctx.restore();
}

/** A uniform translucent native path, without self-intersecting outline fills.
 * Source-over is stable across the separate live and committed canvases; a
 * canvas blend cannot interact with the document underneath its transparent layer.
 * The legacy blend field remains readable for persisted annotation compatibility.
 */
function drawHighlight(
  ctx: InkContext,
  item: Highlight,
  rect: BaseRect,
  color: string,
): void {
  if (item.points.length === 0) return;
  // One native stroke unions all segments before applying alpha. Freehand's
  // outline polygon can self-intersect on tight turns and scribbles, producing
  // winding holes that read as horizontal bands in broad translucent ink.
  ctx.save();
  ctx.globalAlpha = item.opacity;
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = toDisplaySize(item.size, rect);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const first = item.points[0]!;
  if (item.points.length === 1) {
    ctx.ellipse(
      first.x * rect.width,
      first.y * rect.height,
      ctx.lineWidth / 2,
      ctx.lineWidth / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  } else {
    ctx.moveTo(first.x * rect.width, first.y * rect.height);
    for (const point of item.points.slice(1))
      ctx.lineTo(point.x * rect.width, point.y * rect.height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawArrow(
  ctx: InkContext,
  item: ArrowAnno,
  rect: BaseRect,
  color: string,
): void {
  const from = { x: item.from[0] * rect.width, y: item.from[1] * rect.height };
  const to = { x: item.to[0] * rect.width, y: item.to[1] * rect.height };
  const nib = Math.max(toDisplaySize(item.size, rect), 1);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(nib * 3, 6);
  const spread = head * 0.45;

  ctx.save();
  ctx.globalAlpha = item.opacity;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = nib;
  ctx.lineCap = "round";

  // The shaft stops one head-length short so a translucent head does not double
  // up over it.
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(
    to.x - Math.cos(angle) * head * 0.6,
    to.y - Math.sin(angle) * head * 0.6,
  );
  ctx.stroke();

  // A filled triangle, not two short strokes (design §2.1: "尾部带箭头（三角）").
  const backX = to.x - Math.cos(angle) * head;
  const backY = to.y - Math.sin(angle) * head;
  const perpX = -Math.sin(angle) * spread;
  const perpY = Math.cos(angle) * spread;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(backX + perpX, backY + perpY);
  ctx.lineTo(backX - perpX, backY - perpY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawShape(
  ctx: InkContext,
  item: ShapeAnno,
  rect: BaseRect,
  color: string,
): void {
  const x0 = item.from[0] * rect.width;
  const y0 = item.from[1] * rect.height;
  const x1 = item.to[0] * rect.width;
  const y1 = item.to[1] * rect.height;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  const nib = Math.max(toDisplaySize(item.size, rect), 1);

  ctx.save();
  ctx.globalAlpha = item.opacity;
  ctx.lineWidth = nib;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (item.shape === "rect") {
    ctx.rect(left, top, width, height);
  } else {
    ctx.ellipse(
      left + width / 2,
      top + height / 2,
      Math.max(width / 2, 1e-6),
      Math.max(height / 2, 1e-6),
      0,
      0,
      Math.PI * 2,
    );
  }
  if (item.filled) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.restore();
}

function drawText(
  ctx: InkContext,
  item: TextAnno,
  rect: BaseRect,
  color: string,
): void {
  const fontPx = Math.max(toDisplaySize(item.fontSize, rect), 1);

  ctx.save();
  ctx.globalAlpha = item.opacity;
  ctx.fillStyle = color;
  ctx.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
  ctx.textAlign = item.align;
  // `top` keeps the canvas height a function of the font size alone, which is
  // what lets M7's DOM textarea (same font size, same line height) line up.
  ctx.textBaseline = "top";

  const x = item.x * rect.width;
  const lineHeight = fontPx * TEXT_LINE_HEIGHT;
  const lines = item.text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i]!, x, item.y * rect.height + i * lineHeight);
  }
  ctx.restore();
}

/**
 * Draw one item. The single entry point every renderer uses — the live canvas, the
 * committed offscreen cache and the future export all call exactly this, so a mark
 * cannot look different in two of them.
 */
export function drawAnnotation(
  ctx: InkContext,
  item: Annotation,
  rect: BaseRect,
  resolveColor: ColorResolver,
): void {
  const color = resolveColor(item.color);
  switch (item.kind) {
    case "stroke":
      drawStroke(ctx, item, rect, color);
      return;
    case "highlight":
      drawHighlight(ctx, item, rect, color);
      return;
    case "arrow":
      drawArrow(ctx, item, rect, color);
      return;
    case "shape":
      drawShape(ctx, item, rect, color);
      return;
    case "text":
      drawText(ctx, item, rect, color);
      return;
  }
}

/**
 * How much of its alpha a mark keeps while the eraser is over it — the
 * "将被擦除" preview of design §3.3. Low enough to read as doomed next to a
 * fully-opaque neighbour, high enough to still recognise the mark under the nib.
 */
export const ERASER_GHOST_ALPHA = 0.3;

/**
 * `drawAnnotations` extras. Both default to "no preview", so every existing caller
 * (and the P2 PNG bake) keeps the plain replay.
 */
export interface DrawOptions {
  /** Ids the eraser hit during the pass in flight; drawn faded. */
  ghostIds?: ReadonlySet<string> | null;
  /** Overrides {@link ERASER_GHOST_ALPHA}. */
  ghostAlpha?: number;
}

/** Render order is array order (design §3.1: "渲染顺序即数组顺序"). */
export function drawAnnotations(
  ctx: InkContext,
  items: readonly Annotation[],
  rect: BaseRect,
  resolveColor: ColorResolver,
  options: DrawOptions = {},
): void {
  const { ghostIds, ghostAlpha = ERASER_GHOST_ALPHA } = options;
  const ghosts = ghostIds && ghostIds.size > 0 ? ghostIds : null;
  for (const item of items) {
    // A mark the eraser is currently over stays on screen as a fading preview, in
    // its own z-position — it is removed for real when the gesture is committed
    // (design §3.3's whole-stroke erase, seen from the user's side).
    drawAnnotation(
      ctx,
      ghosts && ghosts.has(item.id)
        ? { ...item, opacity: item.opacity * ghostAlpha }
        : item,
      rect,
      resolveColor,
    );
  }
}

/**
 * A stroke's `simulatePressure`, decided **once on release** (design §4.5): real
 * pressure if the sampler saw any variation, velocity simulation otherwise.
 *
 * A mouse reports a constant `0.5` and a pressure-less touchscreen reports a
 * constant `0` or `1`; both are indistinguishable from a perfectly even pen, and
 * simulating from velocity is the better default for them.
 */
export function shouldSimulatePressure(
  points: readonly AnnotationPoint[],
): boolean {
  if (points.length < 2) return true;
  const first = points[0]!.p;
  if (first === undefined) return true;
  for (const point of points) {
    if (point.p === undefined) return true;
    if (Math.abs(point.p - first) > 0.001) return false;
  }
  return true;
}
