// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `text` node type.
 *
 * `docs` is the persisted rich-text document map the text editor writes; the
 * key is the block id and the value is that block's Tiptap document.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";

export type { TextNodeData } from "@workspace/interfaces/models/node/nodes/single/text";

export interface TextContent {
  docs: Record<string, unknown>;
}

export const textSchema: JsonSchema = {
  type: "object",
  required: ["docs"],
  properties: {
    docs: { type: "object" },
  },
  additionalProperties: false,
};

/** A text node with no blocks yet. */
export function createTextContent(): TextContent {
  return { docs: {} };
}
