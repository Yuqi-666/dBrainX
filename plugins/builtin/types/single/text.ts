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

/**
 * A text node with no blocks yet.
 *
 * `docs` is a Tiptap document, not an empty object: the editor seeds itself
 * from whatever is stored, and ProseMirror refuses a document with no `type`
 * (`RangeError: Unknown node type: undefined`). One empty paragraph is what an
 * empty editor holds, so a draft and a cleared node read the same.
 */
export function createTextContent(): TextContent {
  return { docs: { type: "doc", content: [{ type: "paragraph" }] } };
}
