// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The application-side handlers the shipped plugin packages bind.
 *
 * The definitions live in the plugin packages; the handlers live in
 * `backend/application` and this composition root joins them, because a
 * backend layer may not import a plugin package. The plugin host refuses an
 * enable when a declared operation has no handler, so every definition the
 * package contributes must be bound here — including the operations this
 * build does not implement yet, which are bound to a named refusal instead of
 * being omitted and failing the whole enable.
 *
 * The split is not "package A is in-process, package B is not": the counter
 * fixture's `counter.*` operations are application code and stay in this table,
 * while its `acme.*` operations are plugin exports the host runs in the
 * package's worker (plan items 79/80). `createCounterOperationHandlers` leaves
 * those to the worker; when a process composes no worker boundary the fallback
 * below names the missing implementation instead of silently running nothing.
 *
 * `counter.increment` applies the fixture's own rule to the node content the
 * executor loaded and writes the result through the node command service,
 * which publishes the one `NodeUpdated` event of the call.
 */
import { createNodeOperationHandlers } from "../../../backend/application/src/commands/operation/node-operation-handlers.ts";
import type { NodeOperationPort } from "../../../backend/application/src/commands/operation/node-operation-handlers.ts";
import { createEdgeViewOperationHandlers } from "../../../backend/application/src/commands/operation/edge-view-operation-handlers.ts";
import type { EdgeViewOperationPorts } from "../../../backend/application/src/commands/operation/edge-view-operation-handlers.ts";
import type { OperationDefinition } from "../../../backend/domain/src/models/node-type/operation.ts";
import type { OperationHandler } from "../../../backend/domain/src/ports/operation-handler.ts";
import type { OperationContext } from "../../../backend/domain/src/ports/operation-context.ts";
import type { IStoredAttachmentReader } from "../../../backend/domain/src/ports/stored-attachment.ts";
import {
  counterTick,
  incrementCounter,
} from "../../../plugins/counter/server/index.ts";
import type { CounterContent } from "../../../plugins/counter/server/index.ts";

/** Stable code of an operation this build declares but does not implement. */
export const OPERATION_NOT_IMPLEMENTED = "OPERATION_NOT_IMPLEMENTED" as const;

/** A named refusal, so a listed-but-unimplemented operation never runs nothing. */
export class OperationNotImplementedError extends Error {
  readonly code = OPERATION_NOT_IMPLEMENTED;
  readonly operationId: string;

  constructor(operationId: string, handler: string) {
    super(
      `operation "${operationId}" is declared by "${handler}" but this process does not implement it yet`,
    );
    this.name = "OperationNotImplementedError";
    this.operationId = operationId;
  }
}

/**
 * The node command service, resolved on first use.
 *
 * The container owns the service, but it is built with this registry as an
 * argument, so the host cannot read it eagerly.
 */
export type NodeOperationPortProvider = () => NodeOperationPort;

/**
 * The edge and view command services, resolved on first use for the same
 * reason: they are fields of the container this registry is an argument of.
 */
export type GraphOperationPortProvider = () => EdgeViewOperationPorts;

/**
 * The stored upload results the media attach operations read.
 *
 * Resolved on first use like the command services: the reader belongs to the
 * container this registry is an argument of.
 */
export type AttachmentReaderProvider = () => IStoredAttachmentReader;

function lazyPort(provider: NodeOperationPortProvider): NodeOperationPort {
  return {
    createNode: (command) => provider().createNode(command),
    updateNode: (command) => provider().updateNode(command),
    deleteNode: (command) => provider().deleteNode(command),
  };
}

function lazyAttachments(
  provider: AttachmentReaderProvider,
): IStoredAttachmentReader {
  return { find: (attachmentId) => provider().find(attachmentId) };
}

/** Every operation the builtin package declares, bound to its application handler. */
export function createServerOperationHandlers(
  nodes: NodeOperationPortProvider,
  graph: GraphOperationPortProvider,
  attachments: AttachmentReaderProvider,
): Readonly<Record<string, OperationHandler>> {
  const port = lazyPort(nodes);
  return {
    ...createNodeOperationHandlers(port, lazyAttachments(attachments)),
    ...createEdgeViewOperationHandlers({
      edges: {
        createEdge: (command) => graph().edges.createEdge(command),
        updateEdge: (command) => graph().edges.updateEdge(command),
        deleteEdge: (command) => graph().edges.deleteEdge(command),
      },
      views: {
        createView: (command) => graph().views.createView(command),
        updateView: (command) => graph().views.updateView(command),
        deleteView: (command) => graph().views.deleteView(command),
      },
    }),
  };
}

function counterIncrement(port: NodeOperationPort): OperationHandler {
  return async (input, context: OperationContext) => {
    if (context.target.kind !== "node" || context.node === undefined) {
      throw new Error("counter.increment needs the node target snapshot");
    }
    if (context.actor.kind !== "user") {
      throw new Error(
        "counter.increment is bound to a user invocation in this build",
      );
    }
    const next = incrementCounter(
      context.node.content as CounterContent,
      (input as { by?: number }).by,
    );
    const node = await port.updateNode({
      id: context.target.nodeId,
      content: next,
      userId: context.actor.userId,
      correlationId: context.correlationId,
    });
    return { nodeId: node.id };
  };
}

function counterTickHandler(): OperationHandler {
  return async (_input, context: OperationContext) => {
    if (context.target.kind !== "node" || context.node === undefined) {
      throw new Error("counter.tick needs the node target snapshot");
    }
    return counterTick(context.node.content as CounterContent);
  };
}

/**
 * The handlers the counter fixture binds in the host process.
 *
 * The fixture also declares the `acme.*` automation operations. Those are
 * plugin exports, not application code: `createShippedPluginPackages` receives
 * them through `workerOperations` and the host replaces the fallback with the
 * worker handler once the package is prepared. A process that composes no
 * worker boundary keeps the named refusal, which is the honest answer.
 */
export function createCounterOperationHandlers(
  nodes: NodeOperationPortProvider,
): Readonly<Record<string, OperationHandler>> {
  const port = lazyPort(nodes);
  return {
    "counter.increment": counterIncrement(port),
    "counter.tick": counterTickHandler(),
  };
}

/**
 * Bind every definition the package contributes.
 *
 * A definition with a real handler keeps it. One without gets a refusal that
 * names the missing implementation: the host requires a handler per definition
 * to enable the package, and an invocation must fail loudly rather than run
 * nothing.
 */
export function bindOperationHandlers(
  definitions: readonly OperationDefinition[],
  handlers: Readonly<Record<string, OperationHandler>>,
): Readonly<Record<string, OperationHandler>> {
  const bound: Record<string, OperationHandler> = {};
  for (const definition of definitions) {
    bound[definition.id] =
      handlers[definition.id] ??
      (async () => {
        throw new OperationNotImplementedError(definition.id, definition.handler);
      });
  }
  return bound;
}
