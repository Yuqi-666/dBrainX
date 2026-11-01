// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The operation catalogue this host process serves.
 *
 * The definitions come from the plugin packages that ship with the app, exactly
 * as `node-type-registry.ts` seeds the node types; the handlers come from the
 * application layer. Binding happens here because a backend layer may not
 * import a plugin package, and a definition without a handler cannot be
 * registered at all — an unbound operation answers `OPERATION_NOT_FOUND`
 * instead of running nothing.
 *
 * Only the operations this build implements are registered, so `operation.list`
 * never offers an operation that would then fail. The remaining declared
 * operations (icon/cover, permission, tags, delete, the four `*.attachFile`
 * pairs and every per-type self operation) stay unbound until their handlers
 * land; the old endpoints keep serving them in the meantime.
 */
import { createNodeOperationHandlers } from "../../../backend/application/src/commands/operation/node-operation-handlers.ts";
import type { NodeOperationPort } from "../../../backend/application/src/commands/operation/node-operation-handlers.ts";
import { createEdgeViewOperationHandlers } from "../../../backend/application/src/commands/operation/edge-view-operation-handlers.ts";
import type { EdgeViewOperationPorts } from "../../../backend/application/src/commands/operation/edge-view-operation-handlers.ts";
import type { OperationContext } from "../../../backend/domain/src/ports/operation-context.ts";
import { createOperationRegistry } from "../../../backend/domain/src/ports/operation-handler.ts";
import type {
  IOperationHandlerRegistry,
  OperationHandler,
} from "../../../backend/domain/src/ports/operation-handler.ts";
import {
  incrementCounter,
  operations as counterOperations,
} from "../../../plugins/counter/server/index.ts";
import type { CounterContent } from "../../../plugins/counter/server/index.ts";
import { operations as builtinOperations } from "../../../plugins/builtin/server/operations.ts";
import { graphOperations } from "../../../plugins/builtin/server/graph-operations.ts";

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

function lazyPort(provider: NodeOperationPortProvider): NodeOperationPort {
  return {
    createNode: (command) => provider().createNode(command),
    updateNode: (command) => provider().updateNode(command),
  };
}

/**
 * `counter.increment` is the fixture's own rule applied to the node content.
 *
 * The rule (`incrementCounter`) belongs to the plugin package; this binding
 * applies it to the snapshot the executor loaded and writes the result through
 * the node command service, which publishes the one `NodeUpdated` event of the
 * call.
 */
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

export function createServerOperationRegistry(
  nodes: NodeOperationPortProvider,
  graph?: GraphOperationPortProvider,
): IOperationHandlerRegistry {
  const port = lazyPort(nodes);
  const handlers: Readonly<Record<string, OperationHandler>> = {
    ...createNodeOperationHandlers(port),
    ...(graph === undefined
      ? {}
      : createEdgeViewOperationHandlers({
          edges: {
            createEdge: (command) => graph().edges.createEdge(command),
            deleteEdge: (command) => graph().edges.deleteEdge(command),
          },
          views: {
            createView: (command) => graph().views.createView(command),
            deleteView: (command) => graph().views.deleteView(command),
          },
        })),
    "counter.increment": counterIncrement(port),
  };

  const registry = createOperationRegistry();
  for (const definition of [
    ...builtinOperations,
    ...graphOperations,
    ...counterOperations,
  ]) {
    const handler = handlers[definition.id];
    if (handler !== undefined) registry.register(definition, handler);
  }
  return registry;
}
