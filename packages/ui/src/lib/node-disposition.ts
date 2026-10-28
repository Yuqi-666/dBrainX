// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The two node-ending gestures: delete and clear.
 *
 * Both are the same gesture from the node's point of view — its payload goes
 * away — and both can leave an uploaded file behind. The rules live here, not in
 * the menu that starts the gesture, so the graph context menu and the editor
 * header cannot disagree:
 *
 * 1. **A node with no stored file is handled at once.** There is nothing to
 *    dispose of, so the old immediate behavior is kept.
 * 2. **A node with a stored file opens the disposition dialog** and lets the
 *    user choose what happens to the file (`nodeDispositionDialog` in
 *    `useUIStore`).
 * 3. **Clearing a type without one payload is a no-op.** `clearedNodeUpdates`
 *    answers `null` for `collection` / `database`; emptying a table silently is
 *    not the same gesture as emptying a text block, so the entry point hides the
 *    action instead.
 *
 * The dialog itself lives next to the semantic dialogs
 * (`components/dialog/node-disposition-dialog.tsx`). This module holds the
 * store/service half and the resource queries so the dialog only renders state.
 */
import type { NodeData } from "@workspace/interfaces";
import {
  deleteResource,
  listResourcesByIds,
  type ResourceRecord,
} from "@workspace/api-client";
import { NodeService } from "@workspace/services";
import { useDataStore, useUIStore, type UIStore } from "@workspace/store";
import { clearedNodeUpdates } from "@workspace/utils/node-content";
import {
  fileRecordIdsInNode,
  nodeReferencesAnyFile,
} from "@workspace/utils/resource-references";

/** Which of the two node-ending gestures the disposition dialog is asking for. */
export type NodeDispositionMode = UIStore["nodeDispositionDialog"]["mode"];

/**
 * Node types whose content is edited by an **uncontrolled** Tiptap editor
 * (`text-node-content.tsx`, `rich-text-node-content.tsx`).
 *
 * The editor seeds itself once per mount, so after the store content is replaced
 * the open editor has to be remounted. Every other node type renders from the
 * store on each render and needs no signal.
 */
const UNCONTROLLED_EDITOR_NODE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "rich-text",
]);

/** One uploaded resource a node points at, plus the other nodes that share it. */
export interface NodeDispositionResource {
  /** The stored file the node references. */
  resource: ResourceRecord;
  /**
   * Ids of the **other** nodes that also reference the file, never the node the
   * dialog is about. A non-empty list makes the warning in the dialog true:
   * deleting the file clears those nodes' links as well.
   */
  otherNodeIds: string[];
}

/** The live node behind `nodeId`, or `undefined` when it is already gone. */
export function nodeForDisposition(nodeId: string): NodeData | undefined {
  return useDataStore.getState().nodes.get(nodeId);
}

/**
 * Ask to delete a node.
 *
 * A node that references no file is deleted at once; one that does opens the
 * dialog, which also asks whether the referenced files should be deleted.
 */
export async function requestNodeDelete(nodeId: string): Promise<void> {
  const node = nodeForDisposition(nodeId);
  if (!node) return;

  if (nodeReferencesAnyFile(node)) {
    useUIStore.getState().openNodeDispositionDialog(nodeId, "delete");
    return;
  }

  try {
    await applyNodeDelete(nodeId);
  } catch (error) {
    console.error(`[node-disposition] Could not delete node ${nodeId}.`, error);
  }
}

/**
 * Ask to clear a node's content.
 *
 * A node that references no file is cleared at once; one that does opens the
 * dialog, which also asks whether the referenced files should be deleted.
 * A type with no single payload (`collection`, `database`) is left alone.
 */
export async function requestNodeClear(nodeId: string): Promise<void> {
  const node = nodeForDisposition(nodeId);
  if (!node) return;

  const updates = clearedNodeUpdates(node);
  if (!updates) return;

  if (nodeReferencesAnyFile(node)) {
    useUIStore.getState().openNodeDispositionDialog(nodeId, "clear");
    return;
  }

  try {
    await applyNodeClear(node, updates);
  } catch (error) {
    console.error(`[node-disposition] Could not clear node ${nodeId}.`, error);
  }
}

/**
 * Delete the node, then drop it from the editor if it was the open one.
 *
 * Throws when the service fails (it has already rolled the store back), so the
 * dialog can report the failure instead of closing on a silent no-op.
 */
export async function applyNodeDelete(nodeId: string): Promise<void> {
  await NodeService.delete(nodeId);
  const ui = useUIStore.getState();
  if (ui.currentEditingNodeId === nodeId) {
    ui.setCurrentEditingNodeId(null);
  }
}

/**
 * Apply a clear's updates and remount the uncontrolled editor, if there is one.
 *
 * Returns `false` when the node type is not clearable. Throws when the service
 * fails.
 */
export async function applyNodeClear(
  node: NodeData,
  updates?: Record<string, unknown>,
): Promise<boolean> {
  const resolved = updates ?? clearedNodeUpdates(node);
  if (!resolved) return false;
  await NodeService.upsert(node.id, resolved as Partial<NodeData>);
  if (UNCONTROLLED_EDITOR_NODE_TYPES.has(node.nodeType)) {
    useUIStore.getState().resetNodeContent(node.id);
  }
  return true;
}

/**
 * The uploaded resources a node points at, each with the other nodes that share
 * it.
 *
 * The ids come from the addresses inside the node (`fileRecordIdsInNode`), not
 * from a stored relation: a rich-text document embeds the file in its content.
 * The "other nodes" half is advisory and comes from the same query the resource
 * library uses, so a warning and the library's own list agree.
 */
export async function listNodeDispositionResources(
  node: NodeData,
): Promise<NodeDispositionResource[]> {
  const ids = fileRecordIdsInNode(node);
  if (ids.length === 0) return [];

  const resources = await listResourcesByIds(ids);
  return Promise.all(
    resources.map(async (resource) => {
      const referencing = await NodeService.listNodesReferencingFile(
        resource.storedUrl,
      );
      return {
        resource,
        otherNodeIds: referencing
          .map((reference) => reference.id)
          .filter((id) => id !== node.id),
      };
    }),
  );
}

/** Outcome of deleting the files a disposed node referenced. */
export interface DeleteNodeResourcesResult {
  /** Ids of the resources that were deleted (`detachFileReferences` input). */
  deletedIds: string[];
  /** Resources whose deletion failed; the caller reports them and keeps going. */
  failed: ResourceRecord[];
}

/**
 * Delete each resource once, collecting failures instead of aborting.
 *
 * A failed delete must not stop the rest: the node is already gone or cleared,
 * and a partial cleanup with an accurate report beats a half-deleted set.
 */
export async function deleteNodeResources(
  resources: readonly ResourceRecord[],
): Promise<DeleteNodeResourcesResult> {
  const deletedIds: string[] = [];
  const failed: ResourceRecord[] = [];

  for (const resource of resources) {
    try {
      await deleteResource(resource.id);
      deletedIds.push(resource.id);
    } catch (error) {
      console.error(
        `[node-disposition] Could not delete resource ${resource.id}.`,
        error,
      );
      failed.push(resource);
    }
  }

  return { deletedIds, failed };
}
