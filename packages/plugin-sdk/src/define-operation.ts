// SPDX-License-Identifier: AGPL-3.0-only

import type { OperationContext, OperationDefinition } from "@workspace/domain"

/**
 * What a handler receives (§4.3.2 / §4.4.2): the validated input and the host
 * context.
 *
 * The argument order is the domain `OperationHandler` order
 * (`(input, context) => Promise<unknown>`), so a `run` is a handler: the host
 * registers it without an adapter, and the types cannot drift apart.
 */
export type OperationRun<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: OperationContext,
) => Promise<TOutput>

/**
 * Declaration written by a plugin author.
 *
 * `handler` is not part of it: the builder owns that reference, because the
 * export name is only known when the plugin host scans the module exports
 * (§5.4.3). All other fields are the domain `OperationDefinition`, unchanged.
 */
export interface OperationDefinitionOptions<
  TInput = unknown,
  TOutput = unknown,
> extends Omit<OperationDefinition, "handler"> {
  readonly pluginId: string
  readonly run: OperationRun<TInput, TOutput>
}

/** A definition plus its handler; what `defineOperation` returns. */
export interface DefinedOperation<TInput = unknown, TOutput = unknown> {
  /** The registry entry. `handler` is `plugin:<pluginId>#` until an export name is bound. */
  readonly definition: OperationDefinition
  readonly pluginId: string
  readonly run: OperationRun<TInput, TOutput>
  /**
   * Completes `definition.handler` to `plugin:<pluginId>#<exportName>`.
   *
   * The plugin host calls this with the name it found in the module exports;
   * the result is a new object, so the shared definition is never mutated.
   */
  bindExportName(exportName: string): DefinedOperation<TInput, TOutput>
}

/**
 * A definition a plugin declares without a handler instance in this module.
 *
 * Shared operations are declared once and many of them are served by one host
 * handler, so the author names the export the host binds instead of pairing
 * the definition with its own `run` here.
 */
export interface OperationDefinitionSpec
  extends Omit<OperationDefinition, "handler"> {
  readonly pluginId: string
  /** Module export the host binds as this operation's handler. */
  readonly exportName: string
}

const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const TARGET_KINDS = new Set(["workspace", "node", "edge", "view"])
const EFFECTS = new Set(["create", "update", "delete", "invoke"])

/**
 * Declares an operation and its handler once (§5.4.3).
 *
 * Identity plus a cheap structural check; authorization, schema validation and
 * handler resolution belong to the host and the executor.
 */
export function defineOperation<TInput = unknown, TOutput = unknown>(
  options: OperationDefinitionOptions<TInput, TOutput>,
): DefinedOperation<TInput, TOutput> {
  assertOperationOptions(options)
  const { pluginId, run, ...definition } = options
  return buildDefinedOperation(pluginId, run, {
    ...definition,
    handler: `plugin:${pluginId}#`,
  })
}

/**
 * Declares a definition whose handler is named by export, not attached here.
 *
 * This is the shared-operation door: `node.add` and the metadata operations are
 * declared once for every node type and served by host handlers, so there is no
 * `run` to pair with them at declaration time. The result is the registry entry
 * with `handler` already completed to `plugin:<pluginId>#<exportName>`.
 *
 * An operation without an `inputSchema` is refused here instead of at its first
 * call: `SCHEMA_INVALID` must be reachable for every declared operation, and an
 * absent schema would accept any input silently.
 */
export function defineOperationDefinition(
  spec: OperationDefinitionSpec,
): OperationDefinition {
  assertOperationDefinitionSpec(spec)
  const { pluginId, exportName, ...definition } = spec
  return { ...definition, handler: `plugin:${pluginId}#${exportName}` }
}

function assertOperationDefinitionSpec(spec: OperationDefinitionSpec): void {
  const label = `defineOperationDefinition("${String(spec.id)}")`
  if (typeof spec.id !== "string" || spec.id.trim() === "") {
    throw new TypeError("defineOperationDefinition: `id` must be a non-empty string")
  }
  if (typeof spec.pluginId !== "string" || spec.pluginId.trim() === "") {
    throw new TypeError(`${label}: \`pluginId\` must be a non-empty string`)
  }
  if (
    typeof spec.exportName !== "string" ||
    !EXPORT_NAME_PATTERN.test(spec.exportName)
  ) {
    throw new TypeError(
      `${label}: \`exportName\` must be a module export identifier`,
    )
  }
  if (!TARGET_KINDS.has(spec.target)) {
    throw new TypeError(
      `${label}: \`target\` must be workspace, node, edge or view`,
    )
  }
  if (!EFFECTS.has(spec.effect)) {
    throw new TypeError(
      `${label}: \`effect\` must be create, update, delete or invoke`,
    )
  }
  const schema: unknown = spec.inputSchema
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new TypeError(
      `${label}: \`inputSchema\` is required; an operation without a schema is refused`,
    )
  }
  if (!Array.isArray(spec.requiredCapabilities)) {
    throw new TypeError(`${label}: \`requiredCapabilities\` must be an array`)
  }
}

function buildDefinedOperation<TInput, TOutput>(
  pluginId: string,
  run: OperationRun<TInput, TOutput>,
  definition: OperationDefinition,
): DefinedOperation<TInput, TOutput> {
  return {
    definition,
    pluginId,
    run,
    bindExportName(exportName: string) {
      if (typeof exportName !== "string" || exportName.trim() === "") {
        throw new TypeError(
          `defineOperation("${definition.id}"): export name must be a non-empty string`,
        )
      }
      return buildDefinedOperation(pluginId, run, {
        ...definition,
        handler: `plugin:${pluginId}#${exportName}`,
      })
    },
  }
}

function assertOperationOptions<TInput, TOutput>(
  options: OperationDefinitionOptions<TInput, TOutput>,
): void {
  const label = `defineOperation("${String(options.id)}")`
  if (typeof options.id !== "string" || options.id.trim() === "") {
    throw new TypeError("defineOperation: `id` must be a non-empty string")
  }
  if (typeof options.pluginId !== "string" || options.pluginId.trim() === "") {
    throw new TypeError(`${label}: \`pluginId\` must be a non-empty string`)
  }
  if (!TARGET_KINDS.has(options.target)) {
    throw new TypeError(
      `${label}: \`target\` must be workspace, node, edge or view`,
    )
  }
  if (!EFFECTS.has(options.effect)) {
    throw new TypeError(
      `${label}: \`effect\` must be create, update, delete or invoke`,
    )
  }
  if (
    typeof options.inputSchema !== "object" ||
    options.inputSchema === null ||
    !Array.isArray(options.requiredCapabilities) ||
    typeof options.run !== "function"
  ) {
    throw new TypeError(
      `${label}: \`inputSchema\`, \`requiredCapabilities\` and \`run\` are required`,
    )
  }
}
