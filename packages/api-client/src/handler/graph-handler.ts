// SPDX-License-Identifier: AGPL-3.0-only

import { useDataStore, useUIStore, useWorkspaceStore } from "@workspace/store";
import {
  NodeService,
  EdgeService,
  ViewService,
  WorkspaceService,
  NodeSemanticService,
  EdgeSemanticService,
  NodeTagService,
} from "@workspace/services";

type DomainEventHandler = { eventType: string; data: unknown };

function dataId(event: DomainEventHandler): string {
  return (event.data as { id: string }).id;
}

/**
 * Workspace-isolation guard for event-fed entity sync.
 *
 * Only data belonging to the CURRENT workspace may enter the data store. If a
 * `workspaceId` is present on the entity AND differs from
 * `currentWorkspaceId`, the entity is dropped (removed) so a cross-workspace
 * event cannot leak nodes/edges/views into an open workspace.
 *
 * Behaviour when either side is absent:
 * - No current workspace open: keep (historical behaviour).
 * - Entity has no workspaceId: keep (not yet isolated).
 */
function isSameWorkspace(workspaceId: string | undefined): boolean {
  const current = useWorkspaceStore.getState().currentWorkspaceId;
  return !current || !workspaceId || workspaceId === current;
}

export async function handleNodeAdded(event: DomainEventHandler): Promise<void> {
  const id = dataId(event);
  await NodeService.sync([id]);
  const node = useDataStore.getState().nodes.get(id);
  if (node && !isSameWorkspace(node.workspaceId)) {
    useDataStore.getState().deleteNode(id);
  }
}

export async function handleNodeUpdated(event: DomainEventHandler): Promise<void> {
  const id = dataId(event);
  await NodeService.sync([id]);
  const node = useDataStore.getState().nodes.get(id);
  if (node && !isSameWorkspace(node.workspaceId)) {
    useDataStore.getState().deleteNode(id);
  }
}

export function handleNodeDeleted(event: DomainEventHandler): void {
  useDataStore.getState().deleteNode(dataId(event));
}

export async function handleEdgeAdded(event: DomainEventHandler): Promise<void> {
  const id = dataId(event);
  await EdgeService.sync([id]);
  const edge = useDataStore.getState().edges.get(id);
  if (edge && !isSameWorkspace(edge.workspaceId)) {
    useDataStore.getState().deleteEdge(id);
  }
}

export async function handleEdgeUpdated(event: DomainEventHandler): Promise<void> {
  const id = dataId(event);
  await EdgeService.sync([id]);
  const edge = useDataStore.getState().edges.get(id);
  if (edge && !isSameWorkspace(edge.workspaceId)) {
    useDataStore.getState().deleteEdge(id);
  }
}

export function handleEdgeDeleted(event: DomainEventHandler): void {
  useDataStore.getState().deleteEdge(dataId(event));
}

export async function handleViewAdded(event: DomainEventHandler): Promise<void> {
  const id = dataId(event);
  await ViewService.sync([id]);
  const view = useDataStore.getState().views.get(id);
  if (view && !isSameWorkspace(view.workspaceId)) {
    useDataStore.getState().deleteView(id);
  }
}

export async function handleViewUpdated(event: DomainEventHandler): Promise<void> {
  const id = dataId(event);
  await ViewService.sync([id]);
  const view = useDataStore.getState().views.get(id);
  if (view && !isSameWorkspace(view.workspaceId)) {
    useDataStore.getState().deleteView(id);
  }
}

export function handleViewDeleted(event: DomainEventHandler): void {
  useDataStore.getState().deleteView(dataId(event));
}

export async function handleNodeSemanticAdded(event: DomainEventHandler): Promise<void> {
  await NodeSemanticService.sync([dataId(event)]);
  const semantic = useDataStore.getState().nodeSemantics.get(dataId(event));
  if (semantic && !isSameWorkspace(semantic.workspaceId)) {
    useDataStore.getState().deleteNodeSemantic(dataId(event));
  }
}

export async function handleNodeSemanticUpdated(event: DomainEventHandler): Promise<void> {
  await NodeSemanticService.sync([dataId(event)]);
  const semantic = useDataStore.getState().nodeSemantics.get(dataId(event));
  if (semantic && !isSameWorkspace(semantic.workspaceId)) {
    useDataStore.getState().deleteNodeSemantic(dataId(event));
  }
}

export function handleNodeSemanticDeleted(event: DomainEventHandler): void {
  useDataStore.getState().deleteNodeSemantic(dataId(event));
}

export async function handleEdgeSemanticAdded(event: DomainEventHandler): Promise<void> {
  await EdgeSemanticService.sync([dataId(event)]);
  const semantic = useDataStore.getState().edgeSemantics.get(dataId(event));
  if (semantic && !isSameWorkspace(semantic.workspaceId)) {
    useDataStore.getState().deleteEdgeSemantic(dataId(event));
  }
}

export async function handleEdgeSemanticUpdated(event: DomainEventHandler): Promise<void> {
  await EdgeSemanticService.sync([dataId(event)]);
  const semantic = useDataStore.getState().edgeSemantics.get(dataId(event));
  if (semantic && !isSameWorkspace(semantic.workspaceId)) {
    useDataStore.getState().deleteEdgeSemantic(dataId(event));
  }
}

export function handleEdgeSemanticDeleted(event: DomainEventHandler): void {
  useDataStore.getState().deleteEdgeSemantic(dataId(event));
}

export async function handleNodeTagAdded(event: DomainEventHandler): Promise<void> {
  await NodeTagService.sync([dataId(event)]);
  const tag = useDataStore.getState().nodeTags.get(dataId(event));
  if (tag && !isSameWorkspace(tag.workspaceId)) {
    useDataStore.getState().deleteNodeTag(dataId(event));
  }
}

export async function handleNodeTagUpdated(event: DomainEventHandler): Promise<void> {
  await NodeTagService.sync([dataId(event)]);
  const tag = useDataStore.getState().nodeTags.get(dataId(event));
  if (tag && !isSameWorkspace(tag.workspaceId)) {
    useDataStore.getState().deleteNodeTag(dataId(event));
  }
}

export function handleNodeTagDeleted(event: DomainEventHandler): void {
  useDataStore.getState().deleteNodeTag(dataId(event));
}

export async function handleWorkspaceAdded(event: DomainEventHandler): Promise<void> {
  await WorkspaceService.sync([dataId(event)]);
}

export async function handleWorkspaceUpdated(event: DomainEventHandler): Promise<void> {
  await WorkspaceService.sync([dataId(event)]);
}

export function handleWorkspaceDeleted(event: DomainEventHandler): void {
  const store = useWorkspaceStore.getState();
  const id = dataId(event);
  store.setWorkspaces(Array.from(store.workspaces.values()).filter((w) => w.id !== id));
  if (store.currentWorkspaceId === id) {
    store.setCurrentWorkspaceId(null);
    useUIStore.getState().setCurrentViewId(null);
    // The deleted workspace's nodes/edges/views are no longer relevant; clear
    // them so they don't leak into whatever workspace opens next.
    useDataStore.getState().reset();
  }
}

export async function handleWorkspaceMemberAdded(event: DomainEventHandler): Promise<void> {
  const workspaceId = (event.data as { workspaceId: string }).workspaceId;
  if (workspaceId) {
    await WorkspaceService.sync([workspaceId]);
  }
}

export async function handleWorkspaceMemberRemoved(event: DomainEventHandler): Promise<void> {
  const workspaceId = (event.data as { workspaceId: string }).workspaceId;
  if (workspaceId) {
    await WorkspaceService.sync([workspaceId]);
  }
}
