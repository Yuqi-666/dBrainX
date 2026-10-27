// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Annotation primitives — the persisted shape of a node's pen/highlight layer.
 *
 * Contract (annotation.md §3.1): this is the **only** place the annotation model
 * is defined; the UI layer imports these types and never redeclares them. The
 * coordinates are normalized to the base image's display rectangle, so nothing
 * here knows about zoom / rotation / device pixel ratio.
 */

/** Normalized coordinate plus optional pen pressure. `x` / `y` ∈ [0,1]; `p` ∈ [0,1]. */
export interface AnnotationPoint {
  x: number;
  y: number;
  p?: number;
}

interface AnnotationBase {
  id: string;
  /** In-page layer order. Items sharing a `z` fall back to array order. */
  z: number;
  /**
   * Normalized bounding box `[x0, y0, x1, y1]`, used for hit-testing and dirty
   * rectangles. It **must** be inflated beyond the sampled points: the outline
   * produced by `perfect-freehand` overshoots the point bounds by roughly
   * `size / 2` plus a smoothing margin, and a tight box makes both the hit test
   * and the dirty rect miss.
   */
  bbox: [number, number, number, number];
  /** Colour token key (`"red"` | `"yellow"` | …) — never a hex value. */
  color: string;
  opacity: number;
  /** 0-based page index. Must be `undefined` for images; a non-negative integer for pdfs. */
  page?: number;
  createdAt: number;
  /** Written once collaboration lands (P2); omitted in P0. */
  authorId?: string;
}

export interface Stroke extends AnnotationBase {
  kind: "stroke";
  /** Omitted for legacy smooth ink. */
  brush?: "pen" | "pencil" | "fountain" | "marker";
  points: AnnotationPoint[];
  /** Normalized stroke width, relative to the base image's short edge. */
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  simulatePressure: boolean;
}

export interface Highlight extends AnnotationBase {
  kind: "highlight";
  points: AnnotationPoint[];
  size: number;
  /** `"multiply"` on light themes, `"screen"` on dark ones. */
  blend: "multiply" | "screen";
}

export interface TextAnno extends AnnotationBase {
  kind: "text";
  x: number;
  y: number;
  text: string;
  /** Normalized font size, relative to the base image's short edge. */
  fontSize: number;
  align: "left" | "center";
}

export interface ArrowAnno extends AnnotationBase {
  kind: "arrow";
  from: [number, number];
  to: [number, number];
  size: number;
}

export interface ShapeAnno extends AnnotationBase {
  kind: "shape";
  shape: "rect" | "ellipse";
  from: [number, number];
  to: [number, number];
  size: number;
  filled: boolean;
}

export type Annotation = Stroke | Highlight | TextAnno | ArrowAnno | ShapeAnno;

/**
 * Persisted form of the whole layer — versioned so a future migration has a
 * handle. The render order is the array order.
 *
 * `id` stability invariant: an annotation's `id` is minted on the first stroke
 * and never changes, not even across undo/redo (the prerequisite for an
 * operation log / CRDT in P2).
 */
export interface AnnotationLayerData {
  version: 1;
  items: Annotation[];
}
