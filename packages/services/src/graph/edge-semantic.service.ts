// SPDX-License-Identifier: AGPL-3.0-only

import type {
  EdgeSemantic,
  EdgeSemanticId,
  WorkspaceId,
} from "@workspace/interfaces";
import { trpcClient } from "@workspace/api-client";
import { useDataStore, useWorkspaceStore } from "@workspace/store";
import {
  DebounceScheduler,
  resolveDebounceMs,
  shouldDebounce,
} from "@workspace/utils";

const DEFAULT_EDGE_SEMANTIC_UPDATE_DEBOUNCE_MS = 500;
const edgeSemanticUpdateScheduler = new DebounceScheduler<EdgeSemantic, void>(
  DEFAULT_EDGE_SEMANTIC_UPDATE_DEBOUNCE_MS,
);

export interface EdgeSemanticUpsertOptions {
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

export const EdgeSemanticService = {
  async upsert(
    idOrSemantic: EdgeSemanticId | EdgeSemantic,
    updates?: Partial<EdgeSemantic>,
    options?: EdgeSemanticUpsertOptions,
  ): Promise<EdgeSemantic | void> {
    const store = useDataStore.getState();

    if (typeof idOrSemantic === "string") {
      if (!updates) throw new Error("Updates are required for update operation");
      const id = idOrSemantic;
      const oldSemantic = store.edgeSemantics.get(id);
      if (!oldSemantic) throw new Error("Edge semantic not found");
      const merged = { ...oldSemantic, ...updates };

      store.upsertEdgeSemantic(merged);

      if (!shouldDebounce(options?.debounce)) {
        try {
          await trpcClient.edgeSemantic.update.mutate({ id, updates: merged });
        } catch (error) {
          store.upsertEdgeSemantic(oldSemantic);
          throw error;
        }
        return;
      }

      const delayMs = resolveDebounceMs(
        options?.debounce,
        DEFAULT_EDGE_SEMANTIC_UPDATE_DEBOUNCE_MS,
      );

      return edgeSemanticUpdateScheduler.schedule(
        id,
        merged,
        async (payload) => {
          await trpcClient.edgeSemantic.update.mutate({ id, updates: payload });
        },
        (error, originalPayload) => {
          store.upsertEdgeSemantic(originalPayload);
          console.error(
            `[EdgeSemanticService] Debounced update failed for ${id}, rolled back.`,
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
    const result = await trpcClient.edgeSemantic.add.mutate(scopedSemantic);
    store.upsertEdgeSemantic(result);
    return result;
  },

  async delete(id: EdgeSemanticId): Promise<void> {
    const store = useDataStore.getState();
    const oldSemantic = store.edgeSemantics.get(id);
    if (!oldSemantic) throw new Error("Edge semantic not found");
    store.deleteEdgeSemantic(id);
    try {
      await trpcClient.edgeSemantic.delete.mutate({ id });
    } catch (error) {
      store.upsertEdgeSemantic(oldSemantic);
      throw error;
    }
  },

  async sync(ids?: EdgeSemanticId[]): Promise<void> {
    const store = useDataStore.getState();
    if (ids !== undefined) {
      const results: (EdgeSemantic | null)[] = await Promise.all(
        ids.map((id) => trpcClient.edgeSemantic.getById.query({ id })),
      );
      store.upsertEdgeSemantics(
        results.filter((r): r is EdgeSemantic => r !== null),
      );
    } else {
      const results = await trpcClient.edgeSemantic.list.query();
      store.upsertEdgeSemantics(results);
    }
  },

  /**
   * Load all edge semantics scoped to a workspace into the data store.
   * Semantics are now workspace-isolated, so each workspace loads its own set.
   */
  async syncByWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const store = useDataStore.getState();
    const results = await trpcClient.edgeSemantic.listByWorkspace.query({ workspaceId });
    store.loadWorkspaceData({ edgeSemantics: results });
  },

  flushPendingUpdate(id: EdgeSemanticId): Promise<void> | null {
    return edgeSemanticUpdateScheduler.flush(id);
  },

  cancelPendingUpdate(id: EdgeSemanticId): void {
    edgeSemanticUpdateScheduler.cancel(id);
  },
};