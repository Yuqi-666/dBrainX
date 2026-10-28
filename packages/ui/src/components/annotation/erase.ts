// SPDX-License-Identifier: AGPL-3.0-only

import type { Annotation, AnnotationPoint } from "@workspace/interfaces";
import { hitTestItem, withBBox } from "./geometry.ts";

type Ink = Extract<Annotation, { kind: "stroke" | "highlight" }>;
const interpolate = (
  a: AnnotationPoint,
  b: AnnotationPoint,
  t: number,
): AnnotationPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  ...(a.p !== undefined && b.p !== undefined
    ? { p: a.p + (b.p - a.p) * t }
    : {}),
});

/** Cut at actual circle intersections, including sparse two-point strokes. */
function cutCircle(item: Ink, center: AnnotationPoint, radius: number): Ink[] {
  if (!hitTestItem(item, center, radius)) return [item];
  const reach = radius + item.size / 2;
  const chunks: AnnotationPoint[][] = [];
  let chunk: AnnotationPoint[] = [];
  let removed = false;
  const flush = () => {
    if (chunk.length) chunks.push(chunk);
    chunk = [];
  };
  const points = item.points;
  if (points.length === 1) return [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ax = a.x - center.x;
    const ay = a.y - center.y;
    const aa = dx * dx + dy * dy;
    const bb = 2 * (ax * dx + ay * dy);
    const cc = ax * ax + ay * ay - reach * reach;
    const disc = bb * bb - 4 * aa * cc;
    const cuts = [0, 1];
    if (aa > 0 && disc > 0) {
      for (const t of [
        (-bb - Math.sqrt(disc)) / (2 * aa),
        (-bb + Math.sqrt(disc)) / (2 * aa),
      ]) {
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
    cuts.sort((x, y) => x - y);
    for (let j = 1; j < cuts.length; j++) {
      const start = cuts[j - 1]!;
      const end = cuts[j]!;
      const mid = interpolate(a, b, (start + end) / 2);
      if (Math.hypot(mid.x - center.x, mid.y - center.y) < reach) {
        removed = true;
        flush();
        continue;
      }
      const from = interpolate(a, b, start);
      const to = interpolate(a, b, end);
      if (!chunk.length) chunk.push(from);
      chunk.push(to);
    }
  }
  flush();
  if (!removed) return [item];
  return chunks
    .filter((points) => points.length >= 2)
    .map((points) => withBBox({ ...item, points }));
}

/** Sample a swept eraser densely enough that fast moves cannot leave gaps. */
export function eraserSamples(
  from: AnnotationPoint,
  to: AnnotationPoint,
  radius: number,
): AnnotationPoint[] {
  const steps = Math.max(
    1,
    Math.ceil(
      Math.hypot(to.x - from.x, to.y - from.y) / Math.max(radius / 2, 0.0001),
    ),
  );
  return Array.from({ length: steps + 1 }, (_, i) =>
    interpolate(from, to, i / steps),
  );
}

/** Shapes/text keep whole-object erasing; freehand ink is cut locally. */
export function erasePath(
  items: readonly Annotation[],
  samples: readonly AnnotationPoint[],
  radius: number,
): Annotation[] {
  let next = [...items];
  for (const point of samples) {
    next = next.flatMap<Annotation>((item) =>
      item.kind === "stroke" || item.kind === "highlight"
        ? cutCircle(item, point, radius)
        : hitTestItem(item, point, radius)
          ? []
          : [item],
    );
  }
  return next;
}
