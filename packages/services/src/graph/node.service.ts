// SPDX-License-Identifier: AGPL-3.0-only

import type {
  NodeCover,
  NodeData,
  NodeIcon,
  NodeId,
  NodeStateData,
  WorkspaceId,
} from "@workspace/interfaces";
import {
  listNodesReferencingResource,
  resourceIdFromStoredUrl,
  trpcClient,
  type NodeFileReference,
  type OperationResult,
  type OperationTarget,
} from "@workspace/api-client";
import { useDataStore, useUIStore } from "@workspace/store";
import { nodeWithoutFileReferences } from "@workspace/utils/resource-references";
import {
  NODE_OPERATIONS,
  invokeGraphOperation,
  nodeTarget,
  workspaceTarget,
  type GraphInvokeOptions,
  type GraphOperationId,
} from "./operations";
import {
  syncViewEnumerationOnCreate,
  syncViewEnumerationOnDelete,
} from "./view-enum-sync";

export const NodeService = {
  /**
   * The single graph write entry: one `operation.invoke`, then the store update
   * from the canonical snapshot the server reloaded.
   *
   * A refusal is an `OperationInvokeError` carrying the server's code
   * (`VERSION_CONFLICT`, `FORBIDDEN`, `OPERATION_NOT_FOUND`); the store is not
   * touched in that case and the call is never retried here.
   */
  async invoke(
    operationId: GraphOperationId,
    target: OperationTarget,
    input: unknown,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(operationId, target, input, options);
  },

  /**
   * One `operation.invoke` for an operation a node type declares.
   *
   * A type is runtime data after the plugin upgrade (§4.3.4), so its operations
   * (`text.setDocument`, `rich-text.setDocument`, `video.setTimeline`, a third
   * party's `aws.monitor.poll`) are not in the client's compile-time catalogue.
   * The server is authoritative on which ids exist and answers
   * `OPERATION_NOT_FOUND` for one it does not register; the reply's canonical
   * node snapshot is applied exactly like {@link invoke}'s.
   */
  invokeTypeOperation(
    operationId: string,
    id: NodeId,
    input: unknown,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(operationId, nodeTarget(id), input, options);
  },

  /** `node.add`: only the type id is sent; the server supplies the record. */
  async add(
    nodeType: string,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    const result = await invokeGraphOperation(
      NODE_OPERATIONS.add,
      workspaceTarget(),
      { nodeType },
      options,
    );
    if (result.node !== undefined) syncViewEnumerationOnCreate(result.node.id);
    return result;
  },

  /** `node.setTitle`; the reply's node snapshot replaces the stored copy. */
  setTitle(
    id: NodeId,
    title: string,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      NODE_OPERATIONS.setTitle,
      nodeTarget(id),
      { title },
      options,
    );
  },

  /** `node.setAbstract`. */
  setAbstract(
    id: NodeId,
    abstract: string,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      NODE_OPERATIONS.setAbstract,
      nodeTarget(id),
      { abstract },
      options,
    );
  },

  /** `node.setSemanticId`. */
  setSemanticId(
    id: NodeId,
    semanticId: string,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      NODE_OPERATIONS.setSemanticId,
      nodeTarget(id),
      { semanticId },
      options,
    );
  },

  /** `node.setStateData`, the graph-owned position and style payload. */
  setStateData(
    id: NodeId,
    stateData: NodeStateData,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      NODE_OPERATIONS.setStateData,
      nodeTarget(id),
      { stateData },
      options,
    );
  },

  /** `node.setIcon`. */
  setIcon(
    id: NodeId,
    icon: NodeIcon,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      "node.setIcon",
      nodeTarget(id),
      { icon },
      options,
    );
  },

  /** `node.setCover`. */
  setCover(
    id: NodeId,
    cover: NodeCover,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      "node.setCover",
      nodeTarget(id),
      { cover },
      options,
    );
  },

  /** `node.pin` / `node.unpin`, one operation per state. */
  setPinned(
    id: NodeId,
    isPinned: boolean,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      isPinned ? NODE_OPERATIONS.pin : NODE_OPERATIONS.unpin,
      nodeTarget(id),
      {},
      options,
    );
  },

  /** `node.pin`. */
  pin(id: NodeId, options?: GraphInvokeOptions): Promise<OperationResult> {
    return invokeGraphOperation(
      NODE_OPERATIONS.pin,
      nodeTarget(id),
      {},
      options,
    );
  },

  /** `node.unpin`. */
  unpin(id: NodeId, options?: GraphInvokeOptions): Promise<OperationResult> {
    return invokeGraphOperation(
      NODE_OPERATIONS.unpin,
      nodeTarget(id),
      {},
      options,
    );
  },

  /**
   * `node.clearContent`: the server empties the payload this type owns and the
   * reply replaces the stored node.
   *
   * The rule table is the server's (`@workspace/utils/node-content`), so the
   * client no longer sends the emptied content back or guesses what "empty"
   * means for a type.
   */
  clearContent(
    id: NodeId,
    options?: GraphInvokeOptions,
  ): Promise<OperationResult> {
    return invokeGraphOperation(
      NODE_OPERATIONS.clearContent,
      nodeTarget(id),
      {},
      options,
    );
  },

  /**
   * `node.delete`; the store drops the node from the reply's effect.
   *
   * The old shape (delete locally, call the endpoint, restore on failure) is
   * gone: the operation is the one write, and its refusal leaves the store
   * untouched.
   */
  async delete(id: NodeId, options?: GraphInvokeOptions): Promise<void> {
    const node = useDataStore.getState().nodes.get(id);
    if (!node) throw new Error("Node not found");
    await invokeGraphOperation(
      NODE_OPERATIONS.delete,
      nodeTarget(id),
      {},
      options,
    );
    syncViewEnumerationOnDelete(id);
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
   * Runs after the resource delete. The stored records are already correct: the
   * file hook detaches every node that pointed at the blob
   * (`pb/pb_hooks/lib/node-references.js`) on both the web and the desktop
   * stack, so this is a read-back, not a write. The open store is corrected
   * first so the surface the user is looking at never shows a dead link, then
   * reconciled with the server's canonical snapshot; a refetch that fails keeps
   * the open copy rather than leaving the stale address.
   *
   * Only the open store is touched on purpose. The resource dialog also lists
   * nodes in other workspaces; inserting those into the store to fix them would
   * leak another workspace's nodes into the graph of the current one.
   */
  async detachFileReferences(recordIds: readonly string[]): Promise<void> {
    const deleted = new Set(recordIds.filter(Boolean));
    if (deleted.size === 0) return;

    for (const node of [...useDataStore.getState().nodes.values()]) {
      const updates = nodeWithoutFileReferences(node, deleted);
      if (!updates) continue;

      useDataStore
        .getState()
        .upsertNode({ ...node, ...updates } as unknown as NodeData);
      try {
        await NodeService.sync([node.id]);
      } catch (error) {
        console.error(
          `[NodeService] Could not reload ${node.id} after a file delete; kept the open copy.`,
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
    const results = await trpcClient.node.listByWorkspace.query({
      workspaceId,
    });
    store.loadWorkspaceData({ nodes: results });
  },
};
