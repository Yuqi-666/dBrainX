// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The write seam of `useGraph` (plan item 38, §3.5.4.6 and §5.4.7).
 *
 * The hook is a gesture adapter: a pointer gesture becomes an *invocation*
 * (`{operationId, target, input, correlationId}`) and nothing else. It does not
 * build a node, does not guess a per-type content default, and never reaches
 * tRPC. The service layer owns the store write and the network call, through
 * the single `operation.invoke` entry todo 37 landed.
 *
 * Two writes cannot be an invocation from here, and both live in this file:
 *
 * - `node.delete` keeps a helper of its own (`NodeService.delete`), because the
 *   view enumeration has to drop the id as well; the helper itself is one
 *   `node.delete` invocation.
 * - `edge.create` requires a `semanticId` field, and the graph's "add edge"
 *   gesture has no semantic to give: an unlabelled edge is created with the
 *   empty string and named afterwards. `createUnlabelledEdge` is that write.
 */

import type {
  EdgeData,
  EdgeDirection,
  NodeId,
} from "@workspace/interfaces";
import type { OperationResult } from "@workspace/api-client";
import {
  EdgeService,
  NodeService,
  type GraphOperationId,
} from "@workspace/services";

/** The addressable target of an operation; the same shape the router accepts. */
export type GraphOperationTarget =
  | { readonly kind: "workspace"; readonly workspaceId: string }
  | { readonly kind: "node"; readonly nodeId: string }
  | { readonly kind: "edge"; readonly edgeId: string };

export interface GraphOperationInvocation {
  readonly operationId: string;
  readonly target: GraphOperationTarget;
  readonly input: unknown;
  readonly correlationId?: string;
  readonly expectedVersion?: string;
}

/** What the executor reloaded after the handler ran; never what the client sent. */
export type GraphOperationResult = OperationResult;

export type GraphOperationInvoker = (
  invocation: GraphOperationInvocation,
) => Promise<GraphOperationResult>;

const NODE_DELETE = "node.delete";

function nodeIdOf(target: GraphOperationTarget): NodeId {
  if (target.kind !== "node") {
    throw new Error(`expected a node target, received ${target.kind}`);
  }
  return target.nodeId;
}

export const serviceOperationInvoker: GraphOperationInvoker = async (
  invocation,
) => {
  if (invocation.operationId === NODE_DELETE) {
    await NodeService.delete(nodeIdOf(invocation.target));
    return {
      operationId: NODE_DELETE,
      correlationId: invocation.correlationId ?? "",
      output: {},
      eventIds: [],
    };
  }

  return NodeService.invoke(
    invocation.operationId as GraphOperationId,
    invocation.target,
    invocation.input,
    {
      ...(invocation.correlationId === undefined
        ? {}
        : { correlationId: invocation.correlationId }),
      ...(invocation.expectedVersion === undefined
        ? {}
        : { expectedVersion: invocation.expectedVersion }),
    },
  );
};

/**
 * Creates an edge that carries no semantic — the graph's default gesture.
 *
 * `edge.create` accepts the empty string for `semanticId`, so the gesture is the
 * same operation every other edge write uses; the user names the edge afterwards
 * (`edge.setSemanticId`).
 */
export async function createUnlabelledEdge(input: {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly direction: EdgeDirection;
}): Promise<EdgeData> {
  const result = await EdgeService.create({
    from: input.from,
    to: input.to,
    direction: input.direction,
    semanticId: "",
  });
  if (result.edge === undefined) {
    throw new Error("edge.create returned no edge");
  }
  return result.edge as EdgeData;
}
