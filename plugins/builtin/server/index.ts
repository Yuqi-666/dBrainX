// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builtin plugin server entry: the node type and operation contributions.
 *
 * Triggers land in a later plan todo; the package structure is already the one
 * §4.10.2 describes.
 */

import type { OperationDefinition } from "@workspace/plugin-sdk";

import { graphOperations } from "./graph-operations.ts";
import { builtinPluginId, nodeTypes } from "./node-types.ts";
import { operations as metadataOperations } from "./operations.ts";
import { selfOperationIds, typeOperations } from "./type-operations.ts";

export {
  builtinPluginId,
  graphOperations,
  nodeTypes,
  selfOperationIds,
  typeOperations,
};

/**
 * Every operation the package contributes.
 *
 * The server entry is the package's contribution surface: discovery reads this
 * one array, so a new operation group is added here, never to the server
 * composition. `graphOperations` targets the workspace while the other two
 * groups target nodes; the host registers all three from this list.
 */
export const operations: readonly OperationDefinition[] = [
  ...metadataOperations,
  ...typeOperations,
  ...graphOperations,
];
