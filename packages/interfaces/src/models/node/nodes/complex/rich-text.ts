// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeBase, NodeId } from "../../base";
import type { NodeType } from "../../types";
export interface RichTextNodeData extends NodeBase, NodeType<"rich-text"> {
  content: RichTextContent;
}

export interface RichTextContent {
  referencedNodes: NodeId[];
  docs: Record<string, any>;
}
