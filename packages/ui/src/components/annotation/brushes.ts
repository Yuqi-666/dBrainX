// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
import type { Annotation, AnnotationPoint } from "@workspace/interfaces";
import type { AnnotationTool } from "./types";
import { shouldSimulatePressure } from "./draw.ts";

export type BrushTool = Exclude<AnnotationTool, "eraser" | "pointer">;

export const BRUSHES = [
  {
    tool: "pen",
    get label() {
      return translate("圆珠笔");
    },
    shortcut: "P",
    width: 1,
    opacity: 1,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  },
  {
    tool: "pencil",
    get label() {
      return translate("铅笔");
    },
    shortcut: "B",
    width: 0.55,
    opacity: 0.65,
    thinning: 0.65,
    smoothing: 0.25,
    streamline: 0.2,
  },
  {
    tool: "fountain",
    get label() {
      return translate("钢笔");
    },
    shortcut: "F",
    width: 1.2,
    opacity: 1,
    thinning: 0.85,
    smoothing: 0.65,
    streamline: 0.6,
  },
  {
    tool: "marker",
    get label() {
      return translate("马克笔");
    },
    shortcut: "M",
    width: 1.8,
    opacity: 0.9,
    thinning: 0,
    smoothing: 0.5,
    streamline: 0.4,
  },
  {
    tool: "highlighter",
    get label() {
      return translate("荧光笔");
    },
    shortcut: "H",
    width: 3,
    opacity: 0.35,
    thinning: 0,
    smoothing: 0.5,
    streamline: 0.5,
  },
] as const;

/** Live ink and persisted ink use exactly the same brush recipe. */
export function createBrushAnnotation(
  tool: BrushTool,
  points: AnnotationPoint[],
  size: number,
  color: string,
  dark: boolean,
): Annotation {
  const brush = BRUSHES.find((entry) => entry.tool === tool) ?? BRUSHES[0];
  const base = {
    id: "",
    z: 0,
    bbox: [0, 0, 0, 0] as [number, number, number, number],
    createdAt: 0,
    points,
    color,
    size: size * brush.width,
    opacity: brush.opacity,
  };
  if (tool === "highlighter") {
    return { ...base, kind: "highlight", blend: dark ? "screen" : "multiply" };
  }
  return {
    ...base,
    kind: "stroke",
    brush: tool,
    thinning: brush.thinning,
    smoothing: brush.smoothing,
    streamline: brush.streamline,
    simulatePressure: brush.thinning !== 0 && shouldSimulatePressure(points),
  };
}
