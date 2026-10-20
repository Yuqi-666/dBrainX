// SPDX-License-Identifier: AGPL-3.0-only

import type {
  View,
  ViewId,
  WorkspaceId,
} from "@workspace/interfaces";
import { trpcClient } from "@workspace/api-client";
import { useDataStore, useWorkspaceStore } from "@workspace/store";
import {
  DebounceScheduler,
  resolveDebounceMs,
  shouldDebounce,
} from "@workspace/utils";

const DEFAULT_VIEW_UPDATE_DEBOUNCE_MS = 500;
const viewUpdateScheduler = new DebounceScheduler<View, void>(
  DEFAULT_VIEW_UPDATE_DEBOUNCE_MS,
);

export interface ViewUpsertOptions {
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

export const ViewService = {
  async upsert(
    idOrView: ViewId | View,
    updates?: Partial<View>,
    options?: ViewUpsertOptions,
  ): Promise<View | void> {
    const store = useDataStore.getState();

    if (typeof idOrView === "string") {
      if (!updates) throw new Error("Updates are required for update operation");
      const id = idOrView;
      const oldView = store.views.get(id);
      if (!oldView) throw new Error("View not found");
      const merged = { ...oldView, ...updates };

      // 1. Immediately apply to local store.
      store.upsertView(merged);

      if (!shouldDebounce(options?.debounce)) {
        try {
          await trpcClient.view.update.mutate({ id, updates: merged });
        } catch (error) {
          store.upsertView(oldView);
          throw error;
        }
        return;
      }

      const delayMs = resolveDebounceMs(
        options?.debounce,
        DEFAULT_VIEW_UPDATE_DEBOUNCE_MS,
      );

      return viewUpdateScheduler.schedule(
        id,
        merged,
        async (payload) => {
          await trpcClient.view.update.mutate({ id, updates: payload });
        },
        (error, originalPayload) => {
          store.upsertView(originalPayload);
          console.error(
            `[ViewService] Debounced update failed for ${id}, rolled back.`,
            error,
          );
        },
        { delay: delayMs },
      );
    }

    const view = idOrView;
    const workspaceId =
      view.workspaceId ?? useWorkspaceStore.getState().currentWorkspaceId ?? undefined;
    // `view.add` 只接受 `View` 的部分字段：`visualConfig` 不在 addSchema 里
    // （zod 会静默丢弃未知字段，因此它只能由 `view.update` 写入）。显式构造
    // payload，避免字段名对不上时静默丢配置。
    const result = await trpcClient.view.add.mutate({
      id: view.id,
      name: view.name,
      viewType: view.viewType,
      filterConfig: view.filterConfig,
      isPinned: view.isPinned,
      workspaceId,
    });
    store.upsertView(result);
    return result;
  },

  async delete(id: ViewId): Promise<void> {
    const store = useDataStore.getState();
    const oldView = store.views.get(id);
    if (!oldView) throw new Error("View not found");
    // The default global view keeps every workspace renderable; the sidebar
    // hides its delete entry, and the service refuses it too so a stale menu
    // cannot bypass the rule.
    if (oldView.isDefault) throw new Error("The default view cannot be deleted");
    store.deleteView(id);
    try {
      await trpcClient.view.delete.mutate({ id });
    } catch (error) {
      store.upsertView(oldView);
      throw error;
    }
  },

  async sync(ids?: ViewId[]): Promise<void> {
    const store = useDataStore.getState();
    if (ids !== undefined) {
      const results: (View | null)[] = await Promise.all(
        ids.map((id) => trpcClient.view.getById.query({ id })),
      );
      store.upsertViews(results.filter((r): r is View => r !== null));
    } else {
      const results = await trpcClient.view.list.query({});
      store.upsertViews(results);
    }
  },

  /**
   * Load all views scoped to a workspace into the data store.
   * Relies on the `view.listByWorkspace` tRPC procedure (backend B3 pending).
   */
  async syncByWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const store = useDataStore.getState();
    const results = await trpcClient.view.listByWorkspace.query({ workspaceId });
    store.loadWorkspaceData({ views: results });
  },

  flushPendingUpdate(id: ViewId): Promise<void> | null {
    return viewUpdateScheduler.flush(id);
  },

  cancelPendingUpdate(id: ViewId): void {
    viewUpdateScheduler.cancel(id);
  },
};