// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `rich-text` node type.
 *
 * `docs` is the persisted block map; `referencedNodes` lists the graph nodes the
 * document links to, so a rename or delete can find its backlinks without
 * parsing the document.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";
import type { NodeId } from "@workspace/interfaces/models/node/base";

export type { RichTextNodeData } from "@workspace/interfaces/models/node/nodes/complex/rich-text";

export interface RichTextContent {
  referencedNodes: NodeId[];
  docs: Record<string, unknown>;
}

export const richTextSchema: JsonSchema = {
  type: "object",
  required: ["referencedNodes", "docs"],
  properties: {
    referencedNodes: { type: "array", items: { type: "string" } },
    docs: { type: "object" },
  },
  additionalProperties: false,
};

/** A rich-text node with no blocks and no references. */
export function createRichTextContent(): RichTextContent {
  return { referencedNodes: [], docs: {} };
}
