// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `webpage` node type.
 *
 * A webpage node is a stored web page, not a JSON payload: the document's bytes
 * live in the object store and the node keeps only the address. This content is
 * the persisted payload; `fileSize` is flattened back onto the DTO.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";

export type { WebpageNodeData } from "@workspace/interfaces/models/node/nodes/single/webpage";

export interface WebpageContent {
  /**
   * Stored address `/api/files/files/<record>/<name>`; empty before the first
   * import. Treat it as opaque: the record id and the generated name both
   * change when the address is rewritten.
   */
  url: string;
  /** Byte length of the stored document; 0 while the node has no file. */
  fileSize: number;
}

export const webpageSchema: JsonSchema = {
  type: "object",
  required: ["url", "fileSize"],
  properties: {
    url: { type: "string" },
    fileSize: { type: "number", minimum: 0 },
  },
  additionalProperties: false,
};

/** A draft webpage node: no stored document. */
export function createWebpageContent(): WebpageContent {
  return { url: "", fileSize: 0 };
}
