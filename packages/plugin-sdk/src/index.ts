// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The plugin author runtime API (§3.3).
 *
 * This entry is for server-side plugin code (`nodeTypesEntry` / `serverEntry`).
 * Browser bundles import `./ui` instead; nothing here touches a Node builtin,
 * so the entry stays importable from a browser too, but `./server` is the only
 * entry that may.
 *
 * Relative imports carry the `.ts` extension because the package ships source
 * and no build step: Node's own resolver (the acceptance check) does not add an
 * extension, while `allowImportingTsExtensions` keeps `tsc` happy.
 */

export { defineNodeType } from "./define-node-type.ts"

// A plugin imports the node/operation definition types from the root entry too
// (§4.10.3); this re-export is type-only and adds no runtime dependency.
export type * from "./types.ts"

export { defineOperation } from "./define-operation.ts"
export type {
  DefinedOperation,
  OperationDefinitionOptions,
  OperationRun,
} from "./define-operation.ts"

export { defineTrigger } from "./define-trigger.ts"
export type { TriggerDefinitionShape } from "./define-trigger.ts"
