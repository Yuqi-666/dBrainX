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
 * - `node.delete` has no entry in the client operation catalogue
 *   (`packages/services/src/graph/operations.ts`), so the gesture calls
 *   `NodeService.delete`, which is the documented stop-gap until that entry
 *   exists.
 * - `edge.create` requires a non-empty `semanticId` (see
 *   `plugins/builtin/server/graph-operations.ts`), while the graph's "add
 *   edge" gesture has no semantic to give. `createUnlabelledEdge` is that write.
 */

import type {
  EdgeData,
  EdgeDirection,
  EdgeId,
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
 * `edge.create` declares `semanticId` as required with `minLength: 1`, and the
 * "add edge" gesture has none to send, so this stays on the deprecated
 * whole-record service write until the operation schema admits an unlabelled
 * edge or the gesture asks for a semantic.
 */
export async function createUnlabelledEdge(input: {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly direction: EdgeDirection;
}): Promise<EdgeData> {
  const now = new Date().toISOString();
  const created = await EdgeService.upsert({
    id: "tmp_" as EdgeId,
    from: input.from,
    to: input.to,
    direction: input.direction,
    semanticId: "",
    createdAt: now,
    updatedAt: now,
  });
  if (created === undefined) throw new Error("edge.create returned no edge");
  return created;
}
