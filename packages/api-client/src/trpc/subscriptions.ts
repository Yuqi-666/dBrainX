// SPDX-License-Identifier: AGPL-3.0-only

import { trpc } from "./provider";
import {
  handleNodeAdded,
  handleNodeUpdated,
  handleNodeDeleted,
  handleEdgeAdded,
  handleEdgeUpdated,
  handleEdgeDeleted,
  handleViewAdded,
  handleViewUpdated,
  handleViewDeleted,
  handleNodeSemanticAdded,
  handleNodeSemanticUpdated,
  handleNodeSemanticDeleted,
  handleEdgeSemanticAdded,
  handleEdgeSemanticUpdated,
  handleEdgeSemanticDeleted,
  handleNodeTagAdded,
  handleNodeTagUpdated,
  handleNodeTagDeleted,
  handleWorkspaceAdded,
  handleWorkspaceUpdated,
  handleWorkspaceDeleted,
  handleWorkspaceMemberAdded,
  handleWorkspaceMemberRemoved,
} from "../handler/graph-handler";
import { useSourceIdStore } from "@workspace/store";

export function useGraphSubscriptions(): void {
  trpc.event.onEvent.useSubscription(undefined, {
    onData: (event) => {
      const mySourceId = useSourceIdStore.getState().getSourceId();
      const eventSourceId = event.metadata?.sourceId;
      if (eventSourceId && eventSourceId === mySourceId) return;

      switch (event.eventType) {
        case "NodeCreated": handleNodeAdded(event); break;
        case "NodeUpdated": handleNodeUpdated(event); break;
        case "NodeDeleted": handleNodeDeleted(event); break;
        case "EdgeCreated": handleEdgeAdded(event); break;
        case "EdgeUpdated": handleEdgeUpdated(event); break;
        case "EdgeDeleted": handleEdgeDeleted(event); break;
        case "ViewCreated": handleViewAdded(event); break;
        case "ViewUpdated": handleViewUpdated(event); break;
        case "ViewDeleted": handleViewDeleted(event); break;
        case "NodeSemanticCreated": handleNodeSemanticAdded(event); break;
        case "NodeSemanticUpdated": handleNodeSemanticUpdated(event); break;
        case "NodeSemanticDeleted": handleNodeSemanticDeleted(event); break;
        case "EdgeSemanticCreated": handleEdgeSemanticAdded(event); break;
        case "EdgeSemanticUpdated": handleEdgeSemanticUpdated(event); break;
        case "EdgeSemanticDeleted": handleEdgeSemanticDeleted(event); break;
        case "NodeTagCreated": handleNodeTagAdded(event); break;
        case "NodeTagUpdated": handleNodeTagUpdated(event); break;
        case "NodeTagDeleted": handleNodeTagDeleted(event); break;
        case "WorkspaceCreated": handleWorkspaceAdded(event); break;
        case "WorkspaceUpdated": handleWorkspaceUpdated(event); break;
        case "WorkspaceDeleted": handleWorkspaceDeleted(event); break;
        case "WorkspaceMemberAdded": handleWorkspaceMemberAdded(event); break;
        case "WorkspaceMemberRemoved": handleWorkspaceMemberRemoved(event); break;
      }
    },
  });
}
