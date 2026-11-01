// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract types a plugin author needs, re-exported from `@workspace/domain`.
 *
 * Nothing here declares a second shape: each name is an `export type` alias of
 * the domain definition, so a change in `@workspace/domain` reaches plugins
 * without a copy drifting (§4.1.2 boundary rule 5). This entry must stay
 * type-only and free of Node builtins — it is imported by browser bundles
 * through `./ui`.
 *
 * Still missing from `domain`, and therefore not re-exported yet:
 * - `PluginManifest` / `PluginPermission` (plan todo 30)
 * - `OperationContext` / `OperationHandler` (plan todo 28)
 * - `TriggerDefinition` (plan todo 61)
 * - `EventEnvelope`, `Actor`, `CapabilityGrant`, `ExecutionScope`, `SandboxPort`
 */

export type {
  JsonSchema,
  JsonValue,
  JsonSchemaType,
  NodeTypeDefinition,
  ScheduleDefinition,
  NodeSnapshot,
  NodeContentState,
  INodeTypeRegistry,
  NodeTypeRegistryError,
  NodeTypeRegistryErrorCode,
  OperationDefinition,
  OperationEffect,
  OperationInvocation,
  OperationReach,
  OperationTarget,
} from "@workspace/domain"
