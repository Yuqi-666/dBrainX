// SPDX-License-Identifier: AGPL-3.0-only

import type {
  EdgeData,
  EdgeDirection,
  EdgeId,
  WorkspaceId,
} from "@workspace/interfaces";
import {
  trpcClient,
  type OperationResult,
} from "@workspace/api-client";
import { useDataStore } from "@workspace/store";
import {
  EDGE_OPERATIONS,
  edgeTarget,
  invokeGraphOperation,
  workspaceTarget,
  type EdgeOperationInput,
  type GraphInvokeOptions,
} from "./operations";

export const EdgeService = {
  /** `edge.create`: both endpoints and the semantic arrive in one operation. */
  create(
    input: EdgeOperationInput["edge.create"],
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      EDGE_OPERATIONS.create,
      workspaceTarget(),
      input,
      options,
    );
  },

  /** `edge.setLabel`. */
  setLabel(
    id: EdgeId,
    label: string,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      EDGE_OPERATIONS.setLabel,
      edgeTarget(id),
      { label },
      options,
    );
  },

  /** `edge.setSemanticId`. */
  setSemanticId(
    id: EdgeId,
    semanticId: string,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      EDGE_OPERATIONS.setSemanticId,
      edgeTarget(id),
      { semanticId },
      options,
    );
  },

  /** `edge.setDirection`. */
  setDirection(
    id: EdgeId,
    direction: EdgeDirection,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      EDGE_OPERATIONS.setDirection,
      edgeTarget(id),
      { direction },
      options,
    );
  },

  /**
   * `edge.delete`; the store removes the edge from the reply's effect.
   *
   * The old shape (delete locally, call the endpoint, restore on failure) is
   * gone: the operation is the one write, and its refusal leaves the store
   * untouched.
   */
  async delete(id: EdgeId, options?: GraphInvokeOptions): Promise<void> {
    const store = useDataStore.getState();
    const oldEdge = store.edges.get(id);
    if (!oldEdge) throw new Error("Edge not found");
    await invokeGraphOperation(
      EDGE_OPERATIONS.delete,
      edgeTarget(id),
      {},
      options,
    );
  },

  async sync(ids?: EdgeId[]): Promise<void> {
    const store = useDataStore.getState();
    if (ids !== undefined) {
      const results: (EdgeData | null)[] = await Promise.all(
        ids.map((id) => trpcClient.edge.getById.query({ id })),
      );
      store.upsertEdges(results.filter((r): r is EdgeData => r !== null));
    } else {
      const results = await trpcClient.edge.list.query({});
      store.upsertEdges(results);
    }
  },

  /**
   * Load all edges scoped to a workspace into the data store.
   * Relies on the `edge.listByWorkspace` tRPC procedure (backend B3 pending).
   */
  async syncByWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const store = useDataStore.getState();
    const results = await trpcClient.edge.listByWorkspace.query({
      workspaceId,
    });
    store.loadWorkspaceData({ edges: results });
  },
};
