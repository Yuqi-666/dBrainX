// SPDX-License-Identifier: AGPL-3.0-only

import type { DataView } from "../../../data-view";
import type { NodeBase } from "../../base";
import type { NodeType } from "../../types";
import type { FilterConfig } from "@workspace/interfaces/models/filter";

export interface CollectionNodeData extends NodeBase, NodeType<"collection"> {
  content: CollectionContent;
}

export interface CollectionContent {
  filterConfig?: FilterConfig;
  /**
   * Data views attached to this node (see `docs/dataview/README.md`).
   *
   * Collection rows are a read-only projection of the selected graph nodes,
   * so view configs only describe presentation, never writes.
   */
  views?: DataView[];
}
