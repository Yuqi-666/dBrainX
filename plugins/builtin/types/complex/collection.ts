// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `collection` node type.
 *
 * Collection rows are a read-only projection of the selected graph nodes, so
 * the view configs describe presentation only, never writes.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";
import type { DataView } from "@workspace/interfaces/models/data-view";
import type { FilterConfig } from "@workspace/interfaces/models/filter";

export type { CollectionNodeData } from "@workspace/interfaces/models/node/nodes/complex/collection";

export interface CollectionContent {
  filterConfig?: FilterConfig;
  views?: DataView[];
}

export const collectionSchema: JsonSchema = {
  type: "object",
  properties: {
    filterConfig: { type: "object" },
    views: { type: "array", items: { type: "object" } },
  },
  additionalProperties: false,
};

/** A collection with no attached views and no filter. */
export function createCollectionContent(): CollectionContent {
  return { views: [] };
}
