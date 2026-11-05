// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract types a plugin author needs, re-exported from `@workspace/domain`.
 *
 * Nothing here declares a second shape: each name is an `export type` alias of
 * the domain definition, so a change in `@workspace/domain` reaches plugins
 * without a copy drifting (§4.1.2 boundary rule 5). This entry must stay
 * type-only and free of Node builtins — it is imported by browser bundles
 * through `./ui`.
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
  /**
   * The contracts the host holds a plugin to (§4.4.1, §4.5.2, §4.6.2): what a
   * plugin declares, what a trigger is, what a subscriber sees of an event, who
   * acts, and what one execution may touch.
   */
  PluginManifest,
  PluginPermission,
  TriggerDefinition,
  EventEnvelope,
  Actor,
  CapabilityGrant,
  ExecutionScope,
} from "@workspace/domain"
