// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeBase } from "../../base";
import type { NodeType } from "../../types";

export interface TextNodeData extends NodeBase, NodeType<"text"> {
  content: TextContent;
}

export interface TextContent {
  docs: Record<string, any>;
}
