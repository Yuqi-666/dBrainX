// SPDX-License-Identifier: AGPL-3.0-only

import type {
  NodeSemantic,
  NodeSemanticId,
  WorkspaceId,
} from "@workspace/interfaces";
import { trpcClient } from "@workspace/api-client";
import { useDataStore, useWorkspaceStore } from "@workspace/store";
import {
  DebounceScheduler,
  resolveDebounceMs,
  shouldDebounce,
} from "@workspace/utils";

const DEFAULT_NODE_SEMANTIC_UPDATE_DEBOUNCE_MS = 500;
const nodeSemanticUpdateScheduler = new DebounceScheduler<NodeSemantic, void>(
  DEFAULT_NODE_SEMANTIC_UPDATE_DEBOUNCE_MS,
);

export interface NodeSemanticUpsertOptions {
  /**
   * Debounce the API call (tRPC mutation) while keeping the local store
   * update immediate.
   *
   * - `undefined` / `false` (default): call API synchronously, no debounce.
   * - `true`: debounce with the default delay (500ms).
   * - `number`: debounce with the provided delay in milliseconds.
   */
  debounce?: boolean | number;
}

export const NodeSemanticService = {
  async upsert(
    idOrSemantic: NodeSemanticId | NodeSemantic,
    updates?: Partial<NodeSemantic>,
    options?: NodeSemanticUpsertOptions,
  ): Promise<NodeSemantic | void> {
    const store = useDataStore.getState();

    if (typeof idOrSemantic === "string") {
      if (!updates) throw new Error("Updates are required for update operation");
      const id = idOrSemantic;
      const oldSemantic = store.nodeSemantics.get(id);
      if (!oldSemantic) throw new Error("Node semantic not found");
      const merged = { ...oldSemantic, ...updates };

      store.upsertNodeSemantic(merged);

      if (!shouldDebounce(options?.debounce)) {
        try {
          await trpcClient.nodeSemantic.update.mutate({ id, updates: merged });
        } catch (error) {
          store.upsertNodeSemantic(oldSemantic);
          throw error;
        }
        return;
      }

      const delayMs = resolveDebounceMs(
        options?.debounce,
        DEFAULT_NODE_SEMANTIC_UPDATE_DEBOUNCE_MS,
      );

      return nodeSemanticUpdateScheduler.schedule(
        id,
        merged,
        async (payload) => {
          await trpcClient.nodeSemantic.update.mutate({ id, updates: payload });
        },
        (error, originalPayload) => {
          store.upsertNodeSemantic(originalPayload);
          console.error(
            `[NodeSemanticService] Debounced update failed for ${id}, rolled back.`,
            error,
          );
        },
        { delay: delayMs },
      );
    }

    const semantic = idOrSemantic;
    const workspaceId =
      semantic.workspaceId ?? useWorkspaceStore.getState().currentWorkspaceId ?? undefined;
    const scopedSemantic = workspaceId ? { ...semantic, workspaceId } : semantic;
    const result = await trpcClient.nodeSemantic.add.mutate(scopedSemantic);
    store.upsertNodeSemantic(result);
    return result;
  },

  async delete(id: NodeSemanticId): Promise<void> {
    const store = useDataStore.getState();
    const oldSemantic = store.nodeSemantics.get(id);
    if (!oldSemantic) throw new Error("Node semantic not found");
    store.deleteNodeSemantic(id);
    try {
      await trpcClient.nodeSemantic.delete.mutate({ id });
    } catch (error) {
      store.upsertNodeSemantic(oldSemantic);
      throw error;
    }
  },

  async sync(ids?: NodeSemanticId[]): Promise<void> {
    const store = useDataStore.getState();
    if (ids !== undefined) {
      const results: (NodeSemantic | null)[] = await Promise.all(
        ids.map((id) => trpcClient.nodeSemantic.getById.query({ id })),
      );
      store.upsertNodeSemantics(
        results.filter((r): r is NodeSemantic => r !== null),
      );
    } else {
      const results = await trpcClient.nodeSemantic.list.query();
      store.upsertNodeSemantics(results);
    }
  },

  /**
   * Load all node semantics scoped to a workspace into the data store.
   * Semantics are now workspace-isolated, so each workspace loads its own set.
   */
  async syncByWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const store = useDataStore.getState();
    const results = await trpcClient.nodeSemantic.listByWorkspace.query({ workspaceId });
    store.loadWorkspaceData({ nodeSemantics: results });
  },

  flushPendingUpdate(id: NodeSemanticId): Promise<void> | null {
    return nodeSemanticUpdateScheduler.flush(id);
  },

  cancelPendingUpdate(id: NodeSemanticId): void {
    nodeSemanticUpdateScheduler.cancel(id);
  },
};