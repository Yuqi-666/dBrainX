// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The renderer, pinned against a recording context.
 *
 * `draw.ts` touches no DOM API a test cannot fake — that is deliberate, and this
 * file is what keeps it that way. What it can assert without a browser is the part
 * that used to be the reason "it looks wrong on my machine" bugs survive review:
 * the **unit** a size is interpreted in, which branch an item kind takes, and that
 * the pen's pressure decision is made once per stroke.
 *
 * Run with:
 *
 * ```sh
 * pnpm --filter=@workspace/ui test
 * ```
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Annotation } from "@workspace/interfaces";

import {
  drawAnnotation,
  drawAnnotations,
  shouldSimulatePressure,
  strokeOutline,
  type InkContext,
} from "./draw.ts";
import type { BaseRect } from "./types.ts";

const RECT: BaseRect = { left: 0, top: 0, width: 1000, height: 500 };

/** Records every call, so geometry assertions are possible without a canvas. */
class RecordingContext implements InkContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  font = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  readonly ops: string[] = [];
  /**
   * The paint state at the moment of every `fill()`. Recorded *inside* `fill()`
   * because a real context restores it on `restore()` — asserting after the call
   * would only test the stub's teardown.
   */
  readonly fills: {
    alpha: number;
    color: string | CanvasGradient | CanvasPattern;
    blend: GlobalCompositeOperation;
  }[] = [];
  readonly points: [number, number][] = [];
  readonly texts: string[] = [];
  saveCount = 0;
  restoreCount = 0;
  /** `save()` / `restore()` carry the paint state, as a real context does. */
  private readonly stack: {
    globalAlpha: number;
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
    globalCompositeOperation: GlobalCompositeOperation;
  }[] = [];

  save(): void {
    this.saveCount += 1;
    this.ops.push("save");
    this.stack.push({
      globalAlpha: this.globalAlpha,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalCompositeOperation: this.globalCompositeOperation,
    });
  }
  restore(): void {
    this.restoreCount += 1;
    this.ops.push("restore");
    const state = this.stack.pop();
    if (!state) return;
    this.globalAlpha = state.globalAlpha;
    this.fillStyle = state.fillStyle;
    this.strokeStyle = state.strokeStyle;
    this.lineWidth = state.lineWidth;
    this.globalCompositeOperation = state.globalCompositeOperation;
  }
  beginPath(): void {
    this.ops.push("beginPath");
  }
  moveTo(x: number, y: number): void {
    this.ops.push("moveTo");
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.ops.push("lineTo");
    this.points.push([x, y]);
  }
  closePath(): void {
    this.ops.push("closePath");
  }
  rect(): void {
    this.ops.push("rect");
  }
  ellipse(): void {
    this.ops.push("ellipse");
  }
  fill(): void {
    this.ops.push("fill");
    this.fills.push({
      alpha: this.globalAlpha,
      color: this.fillStyle,
      blend: this.globalCompositeOperation,
    });
  }
  stroke(): void {
    this.fills.push({
      alpha: this.globalAlpha,
      color: this.strokeStyle,
      blend: this.globalCompositeOperation,
    });
    this.ops.push("stroke");
  }
  fillText(text: string): void {
    this.ops.push("fillText");
    this.texts.push(text);
  }
}

const nibPen: Annotation = {
  id: "s1",
  kind: "stroke",
  z: 0,
  bbox: [0, 0, 0, 0],
  color: "red",
  opacity: 0.8,
  createdAt: 0,
  points: [
    { x: 0.1, y: 0.2, p: 0.1 },
    { x: 0.5, y: 0.4, p: 0.9 },
    { x: 0.9, y: 0.6, p: 0.2 },
  ],
  size: 0.02,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: false,
};

test("strokeOutline works in pixel space, so its size follows the short edge", () => {
  const outline = strokeOutline(nibPen.points, RECT, {
    size: nibPen.size,
    thinning: nibPen.thinning,
    smoothing: nibPen.smoothing,
    streamline: nibPen.streamline,
    simulatePressure: false,
  });
  assert.ok(outline.length > 3, "an outline polygon came back");

  // A 0.02 nib on a 500px short edge is 10px: the polygon must reach ~5px past the
  // points, and nowhere near 0.02px or 20px. This is the assertion that catches a
  // normalized size being handed to the library.
  const xs = outline.map(([x]) => x!);
  const ys = outline.map(([, y]) => y!);
  assert.ok(
    Math.min(...xs) > 95 && Math.min(...xs) < 105,
    `min x ${Math.min(...xs)}`,
  );
  assert.ok(
    Math.max(...xs) > 895 && Math.max(...xs) < 905,
    `max x ${Math.max(...xs)}`,
  );
  assert.ok(
    Math.min(...ys) > 95 && Math.min(...ys) < 105,
    `min y ${Math.min(...ys)}`,
  );
  assert.ok(
    Math.max(...ys) > 295 && Math.max(...ys) < 305,
    `max y ${Math.max(...ys)}`,
  );
});

test("an empty stroke has no outline and is not drawn", () => {
  assert.deepEqual(
    strokeOutline([], RECT, {
      size: 0.02,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: true,
    }),
    [],
  );
});

test("shouldSimulatePressure is decided once, on release", () => {
  // No pressure at all (a mouse, or a screen without a digitizer).
  assert.equal(
    shouldSimulatePressure([
      { x: 0, y: 0, p: 0.5 },
      { x: 1, y: 0, p: 0.5 },
    ]),
    true,
  );
  // A real pen varies.
  assert.equal(
    shouldSimulatePressure([
      { x: 0, y: 0, p: 0.2 },
      { x: 1, y: 0, p: 0.7 },
    ]),
    false,
  );
  // A missing sample makes the whole stroke simulated rather than half-real.
  assert.equal(
    shouldSimulatePressure([
      { x: 0, y: 0, p: 0.4 },
      { x: 1, y: 0 },
    ]),
    true,
  );
  assert.equal(shouldSimulatePressure([{ x: 0, y: 0, p: 0.4 }]), true);
  assert.equal(shouldSimulatePressure([]), true);
});

// The renderers are exercised through `drawAnnotation`, so the dispatch itself is
// under test: a kind that silently renders nothing is exactly the class of bug a
// type check cannot see.

test("the nib is pixels, not a fraction — the unit that decides blurriness", () => {
  const flat = [
    { x: 0.2, y: 0.5, p: 0.5 },
    { x: 0.8, y: 0.5, p: 0.5 },
  ];
  const outline = strokeOutline(flat, RECT, {
    size: 0.02, // 10px on this 500px short edge
    thinning: 0,
    smoothing: 0.5,
    streamline: 0,
    simulatePressure: false,
  });
  const ys = outline.map(([, y]) => y!);
  const height = Math.max(...ys) - Math.min(...ys);
  // A constant-width 10px nib across 600px of straight travel: ~10px tall. Passing
  // the normalized 0.02 straight to the library would give a 0.02px-tall sliver.
  assert.ok(height > 7 && height < 13, `outline height was ${height}`);
});

test("drawAnnotation fills a pen stroke with its token colour and opacity", () => {
  const ctx = new RecordingContext();
  const asked: string[] = [];
  drawAnnotation(ctx, nibPen, RECT, (key) => {
    asked.push(key);
    return "oklch(0.58 0.22 27)";
  });

  assert.deepEqual(asked, ["red"]);
  assert.deepEqual(ctx.fills, [
    { alpha: 0.8, color: "oklch(0.58 0.22 27)", blend: "source-over" },
  ]);
  assert.ok(ctx.ops.includes("fill"));
  assert.equal(ctx.saveCount, ctx.restoreCount);
});

test("ghosted marks keep their alpha fraction, everything else is untouched", () => {
  const ctx = new RecordingContext();
  const other: Annotation = {
    ...(nibPen as Extract<Annotation, { kind: "stroke" }>),
    id: "s2",
    opacity: 1,
  };
  drawAnnotations(ctx, [nibPen, other], RECT, () => "red", {
    ghostIds: new Set(["s1"]),
  });
  // Two strokes were drawn (save/restore around each fill), and the ghost is the
  // only one whose alpha was scaled: 0.8 → 0.24, the other stays 1.
  assert.equal(ctx.saveCount, 2);
  assert.equal(ctx.saveCount, ctx.restoreCount);
  assert.deepEqual(
    ctx.fills.map((f) => f.alpha),
    [0.24, 1],
  );
});

test("an empty ghost set draws every mark at full alpha", () => {
  const ctx = new RecordingContext();
  drawAnnotations(ctx, [nibPen], RECT, () => "red", { ghostIds: new Set() });
  assert.deepEqual(
    ctx.fills.map((f) => f.alpha),
    [0.8],
  );
  drawAnnotations(ctx, [nibPen], RECT, () => "red", { ghostIds: null });
  assert.deepEqual(
    ctx.fills.map((f) => f.alpha),
    [0.8, 0.8],
  );
});

test("a highlighter paints a single translucent path without outline winding holes", () => {
  const ctx = new RecordingContext();
  const highlight: Annotation = {
    ...nibPen,
    kind: "highlight",
    opacity: 0.35,
    blend: "multiply",
  };
  drawAnnotation(ctx, highlight, RECT, () => "yellow");
  assert.deepEqual(ctx.fills, [
    { alpha: 0.35, color: "yellow", blend: "source-over" },
  ]);
});

test("an arrow draws a shaft plus a filled triangular head", () => {
  const ctx = new RecordingContext();
  const arrow: Annotation = {
    id: "a1",
    kind: "arrow",
    z: 0,
    bbox: [0, 0, 0, 0],
    color: "ink",
    opacity: 1,
    createdAt: 0,
    from: [0.1, 0.5],
    to: [0.9, 0.5],
    size: 0.02,
  };
  drawAnnotation(ctx, arrow, RECT, () => "black");

  assert.equal(ctx.ops.filter((op) => op === "stroke").length, 1);
  assert.equal(ctx.ops.filter((op) => op === "fill").length, 1);
  assert.equal(ctx.ops.filter((op) => op === "closePath").length, 1);
  // The head is a triangle: tip, then the two barbed corners.
  assert.equal(ctx.points.length, 3 + 2);
});

test("an outlined shape strokes and a filled one fills", () => {
  const base = {
    id: "r1",
    kind: "shape" as const,
    z: 0,
    bbox: [0, 0, 0, 0] as [number, number, number, number],
    color: "blue",
    opacity: 1,
    createdAt: 0,
    shape: "rect" as const,
    from: [0.1, 0.1] as [number, number],
    to: [0.5, 0.5] as [number, number],
    size: 0.02,
  };

  const outlined = new RecordingContext();
  drawAnnotation(outlined, { ...base, filled: false }, RECT, () => "blue");
  assert.ok(outlined.ops.includes("rect"));
  assert.ok(outlined.ops.includes("stroke"));
  assert.ok(!outlined.ops.includes("fill"));

  const filled = new RecordingContext();
  drawAnnotation(filled, { ...base, filled: true }, RECT, () => "blue");
  assert.ok(filled.ops.includes("fill"));
  assert.ok(!filled.ops.includes("stroke"));

  const ellipse = new RecordingContext();
  drawAnnotation(
    ellipse,
    { ...base, shape: "ellipse", filled: true },
    RECT,
    () => "blue",
  );
  assert.ok(ellipse.ops.includes("ellipse"));
});

test("text draws one line per newline at the shared line height", () => {
  const ctx = new RecordingContext();
  const text: Annotation = {
    id: "t1",
    kind: "text",
    z: 0,
    bbox: [0, 0, 0, 0],
    color: "ink",
    opacity: 1,
    createdAt: 0,
    x: 0.2,
    y: 0.1,
    text: "第一行\nsecond",
    fontSize: 0.04,
    align: "left",
  };
  drawAnnotation(ctx, text, RECT, () => "black");

  assert.deepEqual(ctx.texts, ["第一行", "second"]);
  // 0.04 × 500px = 20px font.
  assert.match(ctx.font, /^20px /);
  assert.equal(ctx.textAlign, "left");
  assert.equal(ctx.textBaseline, "top");
});

test("brush recipes preserve real pressure and use simulated pressure for mouse input", async () => {
  const { createBrushAnnotation } = await import("./brushes.ts");
  const points = [
    { x: 0.1, y: 0.1, p: 0.2 },
    { x: 0.4, y: 0.3, p: 0.8 },
  ];
  for (const tool of ["pen", "pencil", "fountain"] as const) {
    const pen = createBrushAnnotation(tool, points, 0.008, "red", false);
    assert.equal(pen.kind, "stroke");
    if (pen.kind === "stroke") assert.equal(pen.simulatePressure, false);
    const mouse = createBrushAnnotation(
      tool,
      points.map((p) => ({ ...p, p: 0.5 })),
      0.008,
      "red",
      false,
    );
    if (mouse.kind === "stroke") assert.equal(mouse.simulatePressure, true);
  }
  const marker = createBrushAnnotation("marker", points, 0.008, "blue", false);
  assert.equal(marker.kind, "stroke");
  if (marker.kind === "stroke") assert.equal(marker.simulatePressure, false);
});

test("highlighter stores translucent wide ink with the theme's readable blend", async () => {
  const { createBrushAnnotation } = await import("./brushes.ts");
  for (const dark of [false, true]) {
    const mark = createBrushAnnotation(
      "highlighter",
      [{ x: 0.2, y: 0.3 }],
      0.008,
      "yellow",
      dark,
    );
    assert.equal(mark.kind, "highlight");
    assert.ok(mark.opacity > 0 && mark.opacity < 1);
    assert.ok(mark.size > 0.008);
    if (mark.kind === "highlight")
      assert.equal(mark.blend, dark ? "screen" : "multiply");
  }
});

test("graphite produces deterministic grain instead of a solid outline", () => {
  const pencil: Annotation = {
    ...nibPen,
    kind: "stroke",
    brush: "pencil",
    points: [
      { x: 0.1, y: 0.5, p: 0.5 },
      { x: 0.8, y: 0.5, p: 0.7 },
    ],
  };
  const first = new RecordingContext();
  const second = new RecordingContext();
  drawAnnotation(first, pencil, RECT, () => "gray");
  drawAnnotation(second, pencil, RECT, () => "gray");
  assert.ok(first.ops.filter((op) => op === "rect").length > 100);
  assert.deepEqual(first.ops, second.ops);
  assert.equal(first.ops.includes("lineTo"), false);
});
