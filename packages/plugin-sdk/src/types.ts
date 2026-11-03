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
 * - `TriggerDefinition` (plan todo 61)
 * - `EventEnvelope`, `Actor`, `CapabilityGrant`, `ExecutionScope`
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
  /** What a handler receives; the domain port, not a copy (§4.4.2). */
  OperationContext,
  OperationHandler,
  /**
   * The capability surface `OperationContext` exposes (§4.4.2).
   *
   * A plugin declares its handlers against these names, so they must be
   * reachable from the SDK; re-exporting the domain shapes keeps a plugin from
   * writing a look-alike port that the host would then refuse at runtime.
   */
  HttpMethod,
  HttpPort,
  HttpPortRequest,
  HttpPortResult,
  MediaFetchResult,
  MediaPort,
  MediaTranscodeRequest,
  MediaTranscodeResult,
  NotifyContext,
  NotifyDelivery,
  NotifyLevel,
  NotifyPort,
  NotifyRequest,
  SecretHandle,
  SandboxPort,
  SandboxCommand,
  SandboxEntry,
  SandboxExecResult,
  SandboxFileRef,
  SandboxPath,
  /** The write surface of `writeNode`: the fields a handler may change. */
  NodeMutation,
} from "@workspace/domain"
