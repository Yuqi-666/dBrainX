// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `image` node type.
 *
 * This is the persisted `nodes.content` payload. It carries the media facts
 * (`width` / `height` / `fileSize` / `location` / `shootingTime`) beside the
 * file address and the annotation layer, because the table has no per-type
 * columns; the DTO mapper flattens those facts back onto the node top level.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";

import { annotationLayerSchema } from "../shared/annotation.ts";
import type { AnnotationLayerData } from "../shared/annotation.ts";

export type { ImageNodeData } from "@workspace/interfaces/models/node/nodes/single/image";

export interface ImageContent {
  url: string;
  /** Absent means "no annotations" — old records stay readable. */
  annotations?: AnnotationLayerData;
  width: number;
  height: number;
  fileSize: number;
  location?: string;
  shootingTime?: string;
}

export const imageSchema: JsonSchema = {
  type: "object",
  required: ["url", "width", "height", "fileSize"],
  properties: {
    url: { type: "string" },
    annotations: annotationLayerSchema,
    width: { type: "number", minimum: 0 },
    height: { type: "number", minimum: 0 },
    fileSize: { type: "number", minimum: 0 },
    location: { type: "string" },
    shootingTime: { type: "string" },
  },
  additionalProperties: false,
};

/** A draft image node: no file, zeroed dimensions and no annotations. */
export function createImageContent(): ImageContent {
  return { url: "", width: 0, height: 0, fileSize: 0 };
}
