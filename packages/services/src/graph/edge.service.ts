// SPDX-License-Identifier: AGPL-3.0-only

import type {
  EdgeData,
  EdgeId,
  WorkspaceId,
} from "@workspace/interfaces";
import { trpcClient } from "@workspace/api-client";
import { useDataStore, useWorkspaceStore } from "@workspace/store";
import {
  DebounceScheduler,
  resolveDebounceMs,
  shouldDebounce,
} from "@workspace/utils";

const DEFAULT_EDGE_UPDATE_DEBOUNCE_MS = 500;
const edgeUpdateScheduler = new DebounceScheduler<EdgeData, void>(
  DEFAULT_EDGE_UPDATE_DEBOUNCE_MS,
);

export interface EdgeUpsertOptions {
  /**
   * Debounce the API call (tRPC mutation) while keeping the local store
   * update immediate.
   *
   * - `undefined` / `false` (default): call API synchronously, no debounce.
   * - `true`: debounce with the default delay (500ms).
   * - `number`: debounce with the provided delay in milliseconds.
   *
   * Local state is always updated synchronously regardless of this flag.
   */
  debounce?: boolean | number;
}

export const EdgeService = {
  async upsert(
    idOrEdge: EdgeId | EdgeData,
    updates?: Partial<EdgeData>,
    options?: EdgeUpsertOptions,
  ): Promise<EdgeData | void> {
    const store = useDataStore.getState();

    if (!idOrEdge) throw new Error("Edge is required");

    if (typeof idOrEdge === "string") {
      if (!updates) throw new Error("Updates are required for update operation");
      const id = idOrEdge;
      const oldEdge = store.edges.get(id);
      if (!oldEdge) throw new Error("Edge not found");
      const merged = { ...oldEdge, ...updates };

      // 1. Immediately apply to local store for snappy UX.
      store.upsertEdge(merged);

      if (!shouldDebounce(options?.debounce)) {
        try {
          await trpcClient.edge.update.mutate({ id, updates: merged });
        } catch (error) {
          store.upsertEdge(oldEdge);
          throw error;
        }
        return;
      }

      const delayMs = resolveDebounceMs(
        options?.debounce,
        DEFAULT_EDGE_UPDATE_DEBOUNCE_MS,
      );

      return edgeUpdateScheduler.schedule(
        id,
        merged,
        async (payload) => {
          await trpcClient.edge.update.mutate({ id, updates: payload });
        },
        (error, originalPayload) => {
          store.upsertEdge(originalPayload);
          console.error(
            `[EdgeService] Debounced update failed for ${id}, rolled back.`,
            error,
          );
        },
        { delay: delayMs },
      );
    }

    const edge = idOrEdge;
    const workspaceId =
      edge.workspaceId ?? useWorkspaceStore.getState().currentWorkspaceId ?? undefined;
    const scopedEdge = workspaceId ? { ...edge, workspaceId } : edge;
    const result = await trpcClient.edge.add.mutate(scopedEdge);
    store.upsertEdge(result);
    return result;
  },

  async delete(id: EdgeId): Promise<void> {
    const store = useDataStore.getState();
    const oldEdge = store.edges.get(id);
    if (!oldEdge) throw new Error("Edge not found");
    store.deleteEdge(id);
    try {
      await trpcClient.edge.delete.mutate({ id });
    } catch (error) {
      store.upsertEdge(oldEdge);
      throw error;
    }
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
    const results = await trpcClient.edge.listByWorkspace.query({ workspaceId });
    store.loadWorkspaceData({ edges: results });
  },

  flushPendingUpdate(id: EdgeId): Promise<void> | null {
    return edgeUpdateScheduler.flush(id);
  },

  cancelPendingUpdate(id: EdgeId): void {
    edgeUpdateScheduler.cancel(id);
  },
};
