// SPDX-License-Identifier: AGPL-3.0-only

import type {
  FilterConfig,
  View,
  ViewId,
  ViewType,
  VisualConfig,
  WorkspaceId,
} from "@workspace/interfaces";
import {
  trpcClient,
  type OperationResult,
} from "@workspace/api-client";
import { useDataStore } from "@workspace/store";
import {
  VIEW_OPERATIONS,
  invokeGraphOperation,
  viewTarget,
  workspaceTarget,
  type GraphInvokeOptions,
  type ViewOperationInput,
} from "./operations";

export const ViewService = {
  /** `view.create`; the server generates the id and every config field. */
  create(
    input: ViewOperationInput["view.create"],
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      VIEW_OPERATIONS.create,
      workspaceTarget(),
      input,
      options,
    );
  },

  /** `view.setLayout`, the graph renderer's settings. */
  setLayout(
    id: ViewId,
    visualConfig: VisualConfig,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      VIEW_OPERATIONS.setLayout,
      viewTarget(id),
      { visualConfig },
      options,
    );
  },

  /** `view.setFilter`, the stored query. */
  setFilter(
    id: ViewId,
    filterConfig: FilterConfig,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      VIEW_OPERATIONS.setFilter,
      viewTarget(id),
      { filterConfig },
      options,
    );
  },

  /** `view.setName`. */
  setName(
    id: ViewId,
    name: string,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      VIEW_OPERATIONS.setName,
      viewTarget(id),
      { name },
      options,
    );
  },

  /** `view.setType`, Force or Flow. */
  setType(
    id: ViewId,
    viewType: ViewType,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      VIEW_OPERATIONS.setType,
      viewTarget(id),
      { viewType },
      options,
    );
  },

  /** `view.setPinned`. */
  setPinned(
    id: ViewId,
    isPinned: boolean,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      VIEW_OPERATIONS.setPinned,
      viewTarget(id),
      { isPinned },
      options,
    );
  },

  /** `view.delete`; the server owns the default-view refusal as well. */
  async delete(id: ViewId, options?: GraphInvokeOptions): Promise<void> {
    const store = useDataStore.getState();
    const oldView = store.views.get(id);
    if (!oldView) throw new Error("View not found");
    // The default global view keeps every workspace renderable; the sidebar
    // hides its delete entry, and the service refuses it too so a stale menu
    // cannot bypass the rule.
    if (oldView.isDefault)
      throw new Error("The default view cannot be deleted");
    await invokeGraphOperation(
      VIEW_OPERATIONS.delete,
      viewTarget(id),
      {},
      options,
    );
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
    const results = await trpcClient.view.listByWorkspace.query({
      workspaceId,
    });
    store.loadWorkspaceData({ views: results });
  },
};
