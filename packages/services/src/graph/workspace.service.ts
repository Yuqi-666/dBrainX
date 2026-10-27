// SPDX-License-Identifier: AGPL-3.0-only

import type { Workspace, WorkspaceId } from "@workspace/interfaces";
import { trpcClient } from "@workspace/api-client";
import { useWorkspaceStore, useDataStore, useUIStore } from "@workspace/store";
import { NodeService } from "./node.service";
import { EdgeService } from "./edge.service";
import { ViewService } from "./view.service";
import { NodeSemanticService } from "./node-semantic.service";
import { EdgeSemanticService } from "./edge-semantic.service";
import { NodeTagService } from "./node-tag.service";

/**
 * Workspace-scoped service: create, rename, delete, sync and open.
 *
 * It follows the same optimistic store-first + tRPC + rollback pattern as
 * NodeService/ViewService, and it calls the other graph services when opening a
 * workspace so a workspace change cascades to every workspace-scoped model.
 */
export const WorkspaceService = {
  /**
   * Create or update a workspace.
   * - `string` (WorkspaceId): update — merge `updates` into the current store
   *   copy, then `trpc.workspace.update`; roll back on error.
   * - `Workspace`: create — `trpc.workspace.add`, then merge into the store.
   */
  async upsert(
    idOrWorkspace: WorkspaceId | Workspace,
    updates?: Partial<Workspace>,
  ): Promise<Workspace | void> {
    const wsStore = useWorkspaceStore.getState();

    if (typeof idOrWorkspace === "string") {
      const id = idOrWorkspace;
      if (!updates) throw new Error("Updates are required for update operation");
      const oldWorkspace = wsStore.workspaces.get(id);
      if (!oldWorkspace) throw new Error("Workspace not found");
      const merged = { ...oldWorkspace, ...updates } as Workspace;

      // 1. Immediately apply to local store for snappy UX.
      wsStore.setWorkspaces(
        Array.from(wsStore.workspaces.values()).map((w) =>
          w.id === id ? merged : w,
        ),
      );

      // 2. Persist via tRPC; roll back on failure. The server response is the
      //    source of truth for the fields it normalizes (for example the name
      //    trim and the new `updatedAt`).
      try {
        const saved = await trpcClient.workspace.update.mutate({
          id,
          updates: merged,
        });
        wsStore.setWorkspaces(
          Array.from(wsStore.workspaces.values()).map((w) =>
            w.id === id ? saved : w,
          ),
        );
      } catch (error) {
        wsStore.setWorkspaces(
          Array.from(wsStore.workspaces.values()).map((w) =>
            w.id === id ? oldWorkspace : w,
          ),
        );
        throw error;
      }
      return;
    }

    // Create flow — never debounced (we need the backend-generated id).
    const workspace = idOrWorkspace;
    const result = await trpcClient.workspace.add.mutate(workspace);
    const existing = Array.from(wsStore.workspaces.values()).filter(
      (w) => w.id !== result.id,
    );
    wsStore.setWorkspaces([...existing, result]);
    return result;
  },

  /**
   * Delete one non-default workspace, then make sure the app still has an open
   * workspace.
   *
   * The default workspace (the one provisioned on first login) is structural and
   * cannot be deleted; the selector hides its delete entry and this guard covers
   * a stale menu or a direct call.
   *
   * Store-first, like every other delete: the row disappears immediately and a
   * server failure restores both the list and the previous current id. When the
   * deleted workspace was the open one, its data is dropped before another
   * workspace is loaded — otherwise `open` would see the next workspace's id
   * and decide that its data was already in the store. The default workspace
   * guarantees that one remains, and the `sync` fallback below is only a guard
   * for inconsistent legacy data.
   */
  async delete(id: WorkspaceId): Promise<void> {
    const wsStore = useWorkspaceStore.getState();
    const oldWorkspace = wsStore.workspaces.get(id);
    if (!oldWorkspace) throw new Error("Workspace not found");
    if (oldWorkspace.isDefault) {
      throw new Error("The default workspace cannot be deleted");
    }

    const previous = Array.from(wsStore.workspaces.values());
    const wasCurrent = wsStore.currentWorkspaceId === id;
    const remaining = previous.filter((w) => w.id !== id);

    wsStore.setWorkspaces(remaining);
    if (wasCurrent) {
      wsStore.setCurrentWorkspaceId(remaining[0]?.id ?? null);
    }

    try {
      await trpcClient.workspace.delete.mutate({ id });
    } catch (error) {
      wsStore.setWorkspaces(previous);
      if (wasCurrent) wsStore.setCurrentWorkspaceId(id);
      throw error;
    }

    if (!wasCurrent) return;

    // The deleted workspace's nodes, semantics, tags and views must not leak
    // into the workspace opened next. The editor is a single-node surface, so
    // leaving it also matches what `open` does on a normal workspace switch.
    useDataStore.getState().reset();
    if (useUIStore.getState().mainViewType === "editor") {
      useUIStore
        .getState()
        .setMainViewType(useUIStore.getState().editorReturnViewType);
    }

    const nextWorkspace = remaining[0];
    if (nextWorkspace) {
      await WorkspaceService.open(nextWorkspace.id);
      return;
    }

    // Last workspace: provision a fresh default, then open it.
    await WorkspaceService.sync();
    const next = Array.from(
      useWorkspaceStore.getState().workspaces.values(),
    )[0];
    if (next) await WorkspaceService.open(next.id);
  },

  async sync(ids?: WorkspaceId[]): Promise<void> {
    const wsStore = useWorkspaceStore.getState();
    if (ids !== undefined) {
      const results: (Workspace | null)[] = await Promise.all(
        ids.map((id) => trpcClient.workspace.getById.query({ id })),
      );
      wsStore.setWorkspaces(results.filter((r): r is Workspace => r !== null));
      return;
    }

    // First login: a brand-new user has zero workspaces. Auto-provision a
    // default workspace (owned by them, with a global view), then re-list.
    const current = await trpcClient.workspace.listByUser.query({});
    if (current.length === 0) {
      await trpcClient.workspace.provisionDefault.mutate();
    }
    const results = await trpcClient.workspace.listByUser.query({});
    wsStore.setWorkspaces(results);
  },

  /**
   * Open a workspace: set it as the current workspace, then load the
   * workspace-scoped data via the per-model `syncByWorkspace` calls. Finally,
   * set the active view to the first view that was loaded (if any).
   *
   * Data isolation: switching to a *different* workspace resets the data store
   * first so the previous workspace's nodes/edges/views never leak into the new
   * one, and leaves a focused editor while preserving dashboard mode. Opening the
   * *same* workspace only reloads when its data is not present
   * (e.g. an initially-empty workspace just seeded — the seed writes to the
   * backend, so re-open reloads it into the store).
   */
  async open(workspaceId: WorkspaceId): Promise<void> {
    const prevWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId;
    useWorkspaceStore.getState().setCurrentWorkspaceId(workspaceId);

    const dataStore = useDataStore.getState();
    const isWorkspaceSwitch = prevWorkspaceId !== null && prevWorkspaceId !== workspaceId;

    // Leave a focused editor when switching workspaces. Dashboard stays open
    // and selects its new workspace-scoped pages. The editor view is a
    // focused, single-node surface whose context belongs to the previous
    // workspace, so returning to it would show stale content.
    if (isWorkspaceSwitch && useUIStore.getState().mainViewType === "editor") {
      useUIStore.getState().setMainViewType(useUIStore.getState().editorReturnViewType);
    }

    if (isWorkspaceSwitch || dataStore.nodes.size === 0 || dataStore.views.size === 0) {
      if (isWorkspaceSwitch) {
        useDataStore.getState().reset();
      }
      // Semantics and tags are workspace-scoped, so they are loaded alongside
      // the workspace data via their per-workspace sync. The reset() above
      // clears them on a workspace switch; the per-workspace sync re-fills only
      // the current workspace's own semantic set, preventing cross-workspace
      // leakage.
      await Promise.all([
        NodeService.syncByWorkspace(workspaceId),
        EdgeService.syncByWorkspace(workspaceId),
        ViewService.syncByWorkspace(workspaceId),
        NodeSemanticService.syncByWorkspace(workspaceId),
        EdgeSemanticService.syncByWorkspace(workspaceId),
        NodeTagService.syncByWorkspace(workspaceId),
      ]);
    }

    const views = useDataStore.getState().views;
    if (views.size > 0) {
      const firstViewId = views.values().next().value?.id;
      if (firstViewId) {
        useUIStore.getState().setCurrentViewId(firstViewId);
      }
    }
  },
};
