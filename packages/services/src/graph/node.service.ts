// SPDX-License-Identifier: AGPL-3.0-only

import type {
  NodeData,
  NodeId,
  WorkspaceId,
} from "@workspace/interfaces";
import {
  listNodesReferencingResource,
  resourceIdFromStoredUrl,
  trpcClient,
  type NodeFileReference,
} from "@workspace/api-client";
import { useDataStore, useUIStore, useWorkspaceStore } from "@workspace/store";
import {
  DebounceScheduler,
  resolveDebounceMs,
  shouldDebounce,
} from "@workspace/utils";
import { nodeWithoutFileReferences } from "@workspace/utils/resource-references";
import {
  syncViewEnumerationOnCreate,
  syncViewEnumerationOnDelete,
} from "./view-enum-sync";

const DEFAULT_NODE_UPDATE_DEBOUNCE_MS = 500;
const nodeUpdateScheduler = new DebounceScheduler<NodeData, void>(
  DEFAULT_NODE_UPDATE_DEBOUNCE_MS,
);

export interface NodeUpsertOptions {
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

export const NodeService = {
  async upsert(
    idOrNode: NodeId | NodeData,
    updates?: Partial<NodeData>,
    options?: NodeUpsertOptions,
  ): Promise<NodeData | void> {
    const store = useDataStore.getState();

    if (typeof idOrNode === "string") {
      const id = idOrNode;
      if (!updates) throw new Error("Updates are required for update operation");
      const oldNode = store.nodes.get(id);
      if (!oldNode) throw new Error("Node not found");
      const merged = { ...oldNode, ...updates } as NodeData;

      // 1. Immediately apply to local store for snappy UX.
      store.upsertNode(merged);

      // 2. Choose the API path.
      if (!shouldDebounce(options?.debounce)) {
        try {
          await trpcClient.node.update.mutate({ id, updates: merged });
        } catch (error) {
          store.upsertNode(oldNode);
          throw error;
        }
        return;
      }

      // 3. Debounced path — schedule (or merge into) the pending tRPC call.
      const delayMs = resolveDebounceMs(
        options?.debounce,
        DEFAULT_NODE_UPDATE_DEBOUNCE_MS,
      );

      return nodeUpdateScheduler.schedule(
        id,
        merged,
        async (payload) => {
          await trpcClient.node.update.mutate({ id, updates: payload });
        },
        (error, originalPayload) => {
          // Roll back to the snapshot captured before the first change in
          // this debounce window.
          store.upsertNode(originalPayload);
          console.error(
            `[NodeService] Debounced update failed for ${id}, rolled back.`,
            error,
          );
        },
        { delay: delayMs },
      );
    }

    // Create flow — never debounced (we need the backend-generated id).
    // Stamp the current workspace id so every created node is scoped to the
    // active workspace, regardless of which UI code triggered the create.
    const node = idOrNode;
    const workspaceId =
      node.workspaceId ?? useWorkspaceStore.getState().currentWorkspaceId ?? undefined;
    const scopedNode = workspaceId ? { ...node, workspaceId } : node;
    const result = await trpcClient.node.add.mutate(scopedNode);
    store.upsertNode(result);
    syncViewEnumerationOnCreate(result.id);
    return result;
  },

  async delete(id: NodeId): Promise<void> {
    const store = useDataStore.getState();
    const oldNode = store.nodes.get(id);
    if (!oldNode) throw new Error("Node not found");
    store.deleteNode(id);
    syncViewEnumerationOnDelete(id);
    try {
      await trpcClient.node.delete.mutate({ id });
    } catch (error) {
      store.upsertNode(oldNode);
      throw error;
    }
  },

  /**
   * Nodes that point at one stored file, from the open store and the database.
   *
   * The store is authoritative for the nodes the user is looking at: the
   * desktop local mode keeps its nodes outside PocketBase, so a database query
   * alone would answer nothing there. The database adds the nodes in other
   * workspaces, which the store never loads. The union is what the resource
   * delete dialog lists before it warns the user.
   */
  async listNodesReferencingFile(
    storedUrl: string,
  ): Promise<NodeFileReference[]> {
    const recordId = resourceIdFromStoredUrl(storedUrl);
    if (!recordId) return [];

    const recordIds = new Set([recordId]);
    const local = [...useDataStore.getState().nodes.values()]
      .filter((node) => nodeWithoutFileReferences(node, recordIds) !== null)
      .map((node) => ({
        id: node.id,
        title: node.title,
        nodeType: node.nodeType,
      }));

    let remote: NodeFileReference[] = [];
    try {
      remote = await listNodesReferencingResource(storedUrl);
    } catch {
      remote = [];
    }

    const seen = new Set(local.map((node) => node.id));
    return [...local, ...remote.filter((node) => !seen.has(node.id))];
  },

  /**
   * Clears deleted files from the nodes in the open store.
   *
   * Runs after the resource delete, so the server hook has already fixed the
   * stored records on the web stack. The store is fixed here as well: without
   * it the graph keeps the stale address until a reload, and in the desktop
   * local mode the nodes are not in PocketBase at all, so no server hook will
   * ever see them.
   *
   * Only the open store is touched on purpose. The resource dialog also lists
   * nodes in other workspaces; inserting those into the store to fix them would
   * leak another workspace's nodes into the graph of the current one. Their
   * stored records were cleared by the server hook and they load cleared when
   * their workspace is opened; on the desktop they keep the address until that
   * workspace is opened and saved, which the desktop's local store cannot see
   * from here.
   */
  async detachFileReferences(recordIds: readonly string[]): Promise<void> {
    const deleted = new Set(recordIds.filter(Boolean));
    if (deleted.size === 0) return;
    const store = useDataStore.getState();

    for (const node of [...store.nodes.values()]) {
      const updates = nodeWithoutFileReferences(node, deleted);
      if (!updates) continue;
      try {
        await NodeService.upsert(node.id, updates as Partial<NodeData>);
      } catch (error) {
        // The record is already deleted, and on the web stack the server hook
        // has already fixed the stored node; an update the user may not write
        // (a viewer of a shared workspace) must not leave the open surface
        // showing a dead link until a reload. The local copy is corrected here;
        // the next load reads the server's cleared record.
        useDataStore
          .getState()
          .upsertNode({ ...node, ...updates } as unknown as NodeData);
        console.error(
          `[NodeService] Could not clear deleted files from ${node.id}; corrected the open copy only.`,
          error,
        );
      }
      // The open text / rich-text editor is uncontrolled and seeds itself once
      // per mount; only a replaced document needs a remount (icon, cover and
      // media payloads are read from the store on every render).
      if (
        "content" in updates &&
        (node.nodeType === "text" || node.nodeType === "rich-text")
      ) {
        useUIStore.getState().resetNodeContent(node.id);
      }
    }
  },

  async sync(ids?: NodeId[]): Promise<void> {
    const store = useDataStore.getState();
    if (ids !== undefined) {
      const results: (NodeData | null)[] = await Promise.all(
        ids.map((id) => trpcClient.node.getById.query({ id })),
      );
      store.upsertNodes(results.filter((r): r is NodeData => r !== null));
    } else {
      const results = await trpcClient.node.list.query({});
      store.upsertNodes(results);
    }
  },

  /**
   * Load all nodes scoped to a workspace into the data store.
   * Relies on the `node.listByWorkspace` tRPC procedure (backend B3 pending).
   */
  async syncByWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const store = useDataStore.getState();
    const results = await trpcClient.node.listByWorkspace.query({ workspaceId });
    store.loadWorkspaceData({ nodes: results });
  },

  /**
   * Flush any pending debounced node update immediately. Useful for tests
   * or for ensuring persistence before unmount.
   */
  flushPendingUpdate(id: NodeId): Promise<void> | null {
    return nodeUpdateScheduler.flush(id);
  },

  /** Cancel a pending debounced update for `id` without persisting. */
  cancelPendingUpdate(id: NodeId): void {
    nodeUpdateScheduler.cancel(id);
  },
};