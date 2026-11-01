// SPDX-License-Identifier: AGPL-3.0-only

import { trpc } from "./provider";
import { createEventConvergence, type StreamEvent } from "./event-convergence";
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

async function dispatch(event: StreamEvent): Promise<void> {
  switch (event.eventType) {
    case "NodeCreated":
      await handleNodeAdded(event);
      break;
    case "NodeUpdated":
      await handleNodeUpdated(event);
      break;
    case "NodeDeleted":
      handleNodeDeleted(event);
      break;
    case "EdgeCreated":
      await handleEdgeAdded(event);
      break;
    case "EdgeUpdated":
      await handleEdgeUpdated(event);
      break;
    case "EdgeDeleted":
      handleEdgeDeleted(event);
      break;
    case "ViewCreated":
      await handleViewAdded(event);
      break;
    case "ViewUpdated":
      await handleViewUpdated(event);
      break;
    case "ViewDeleted":
      handleViewDeleted(event);
      break;
    case "NodeSemanticCreated":
      await handleNodeSemanticAdded(event);
      break;
    case "NodeSemanticUpdated":
      await handleNodeSemanticUpdated(event);
      break;
    case "NodeSemanticDeleted":
      handleNodeSemanticDeleted(event);
      break;
    case "EdgeSemanticCreated":
      await handleEdgeSemanticAdded(event);
      break;
    case "EdgeSemanticUpdated":
      await handleEdgeSemanticUpdated(event);
      break;
    case "EdgeSemanticDeleted":
      handleEdgeSemanticDeleted(event);
      break;
    case "NodeTagCreated":
      await handleNodeTagAdded(event);
      break;
    case "NodeTagUpdated":
      await handleNodeTagUpdated(event);
      break;
    case "NodeTagDeleted":
      handleNodeTagDeleted(event);
      break;
    case "WorkspaceCreated":
      await handleWorkspaceAdded(event);
      break;
    case "WorkspaceUpdated":
      await handleWorkspaceUpdated(event);
      break;
    case "WorkspaceDeleted":
      handleWorkspaceDeleted(event);
      break;
    case "WorkspaceMemberAdded":
      await handleWorkspaceMemberAdded(event);
      break;
    case "WorkspaceMemberRemoved":
      await handleWorkspaceMemberRemoved(event);
      break;
    default:
      // A plugin event the graph does not render; ignoring it is the contract.
      break;
  }
}

/**
 * The graph event stream, deduped by the envelope identity (§3.5.4.4).
 *
 * A reconnect can replay a page the client already applied. The applied window
 * is one per client — module state, not a render's — so it survives a
 * re-subscription and a remount, and a replayed `eventId` (or a message that
 * only carries the same `cursor`) never reaches the stores twice. An event this
 * client caused is recorded in the same window without being applied, so its
 * replay is a duplicate too.
 */
const convergence = createEventConvergence<StreamEvent>({
  apply: dispatch,
  isOwnOperation: (event) => {
    const eventSourceId = event.metadata?.sourceId;
    if (eventSourceId === undefined || eventSourceId === "") return false;
    return eventSourceId === useSourceIdStore.getState().getSourceId();
  },
});

export function useGraphSubscriptions(): void {
  trpc.event.onEvent.useSubscription(undefined, {
    onData: (event) => {
      void convergence.accept(event).catch((error: unknown) => {
        console.error(
          `[events] ${event.eventType} could not be applied`,
          error,
        );
      });
    },
  });
}
