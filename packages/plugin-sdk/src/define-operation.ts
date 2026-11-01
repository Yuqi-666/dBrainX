// SPDX-License-Identifier: AGPL-3.0-only

import type { OperationDefinition } from "@workspace/domain"

/**
 * What a handler receives (§4.3.2): the validated input and the host context.
 *
 * `TContext` stays a generic until `OperationContext` lands in `domain`
 * (plan todo 28); the executor passes that context and plugin code keeps the
 * same `run({ input, ctx })` shape before and after.
 */
export type OperationRun<
  TInput = unknown,
  TOutput = unknown,
  TContext = unknown,
> = (args: { readonly input: TInput; readonly ctx: TContext }) => Promise<TOutput>

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
  TContext = unknown,
> extends Omit<OperationDefinition, "handler"> {
  readonly pluginId: string
  readonly run: OperationRun<TInput, TOutput, TContext>
}

/** A definition plus its handler; what `defineOperation` returns. */
export interface DefinedOperation<
  TInput = unknown,
  TOutput = unknown,
  TContext = unknown,
> {
  /** The registry entry. `handler` is `plugin:<pluginId>#` until an export name is bound. */
  readonly definition: OperationDefinition
  readonly pluginId: string
  readonly run: OperationRun<TInput, TOutput, TContext>
  /**
   * Completes `definition.handler` to `plugin:<pluginId>#<exportName>`.
   *
   * The plugin host calls this with the name it found in the module exports;
   * the result is a new object, so the shared definition is never mutated.
   */
  bindExportName(exportName: string): DefinedOperation<TInput, TOutput, TContext>
}

const TARGET_KINDS = new Set(["workspace", "node", "edge", "view"])
const EFFECTS = new Set(["create", "update", "delete", "invoke"])

/**
 * Declares an operation and its handler once (§5.4.3).
 *
 * Identity plus a cheap structural check; authorization, schema validation and
 * handler resolution belong to the host and the executor.
 */
export function defineOperation<
  TInput = unknown,
  TOutput = unknown,
  TContext = unknown,
>(
  options: OperationDefinitionOptions<TInput, TOutput, TContext>,
): DefinedOperation<TInput, TOutput, TContext> {
  assertOperationOptions(options)
  const { pluginId, run, ...definition } = options
  return buildDefinedOperation(pluginId, run, {
    ...definition,
    handler: `plugin:${pluginId}#`,
  })
}

function buildDefinedOperation<TInput, TOutput, TContext>(
  pluginId: string,
  run: OperationRun<TInput, TOutput, TContext>,
  definition: OperationDefinition,
): DefinedOperation<TInput, TOutput, TContext> {
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

function assertOperationOptions<TInput, TOutput, TContext>(
  options: OperationDefinitionOptions<TInput, TOutput, TContext>,
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
