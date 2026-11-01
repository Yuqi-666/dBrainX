// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builtin plugin server entry: the node type and operation contributions.
 *
 * Triggers land in a later plan todo; the package structure is already the one
 * §4.10.2 describes.
 */

export { builtinPluginId, nodeTypes } from "./node-types.ts";
export { operations } from "./operations.ts";
export { selfOperationIds, typeOperations } from "./type-operations.ts";
