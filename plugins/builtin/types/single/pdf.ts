// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `pdf` node type.
 *
 * This is the persisted `nodes.content` payload: the file address, its cover,
 * the annotation layer and the page facts the DTO flattens back onto the node.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";

import { annotationLayerSchema } from "../shared/annotation.ts";
import type { AnnotationLayerData } from "../shared/annotation.ts";

export type { PdfNodeData } from "@workspace/interfaces/models/node/nodes/single/pdf";

export interface PdfContent {
  url: string;
  coverUrl: string;
  /** Absent means "no annotations" — old records stay readable. */
  annotations?: AnnotationLayerData;
  pageCount: number;
  fileSize: number;
}

export const pdfSchema: JsonSchema = {
  type: "object",
  required: ["url", "coverUrl", "pageCount", "fileSize"],
  properties: {
    url: { type: "string" },
    coverUrl: { type: "string" },
    annotations: annotationLayerSchema,
    pageCount: { type: "integer", minimum: 0 },
    fileSize: { type: "number", minimum: 0 },
  },
  additionalProperties: false,
};

/** A draft pdf node: no file, no cover and no pages. */
export function createPdfContent(): PdfContent {
  return { url: "", coverUrl: "", pageCount: 0, fileSize: 0 };
}
