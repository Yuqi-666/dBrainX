// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useMemo } from "react";
import type {
  EdgeDirection,
  EdgeId,
  NodeDataType,
  NodeId,
} from "@workspace/interfaces";
import { useUIStore, useWorkspaceStore } from "@workspace/store";

import {
  addNode,
  changeEdgeDirection,
  changeEdgeSemantic,
  changeNodeSemantic,
  createEdge,
  deleteEdge,
  deleteSelected,
  type AddNodePosition,
  type AddNodeResult,
  type GraphContextMenuRequest,
  type GraphGesturePorts,
} from "./graph-gestures.ts";
import {
  createUnlabelledEdge,
  serviceOperationInvoker,
  type GraphOperationInvoker,
} from "./graph-operations.ts";

export type { AddNodeResult, GraphContextMenuRequest } from "./graph-gestures.ts";

export interface UseGraphOptions {
  /**
   * The write path. Defaults to the service layer's operation entry
   * (`NodeService.invoke`). A test injects a recorder here.
   */
  readonly invoke?: GraphOperationInvoker;
}

/**
 * The graph's read / selection / gesture surface.
 *
 * Every write is an invocation handed to the service layer; the hook keeps the
 * selection side effect (`onEditNode`) and the gesture-to-invocation mapping.
 */
export function useGraph(options: UseGraphOptions = {}) {
  const setCurrentEditingNodeId = useUIStore(
    (state) => state.setCurrentEditingNodeId,
  );
  const currentWorkspaceId = useWorkspaceStore(
    (state) => state.currentWorkspaceId,
  );

  const ports = useMemo<GraphGesturePorts>(
    () => ({
      invoke: options.invoke ?? serviceOperationInvoker,
      createEdge: createUnlabelledEdge,
      currentWorkspaceId,
      openNodeEditor: (nodeId) => setCurrentEditingNodeId(nodeId),
      reportFailure: (failure) => {
        console.error(
          `[useGraph] ${failure.operationId} failed:`,
          failure.error,
        );
      },
    }),
    [options.invoke, currentWorkspaceId, setCurrentEditingNodeId],
  );

  const onEditNode = useCallback(
    (nodeId: NodeId) => {
      setCurrentEditingNodeId(nodeId);
    },
    [setCurrentEditingNodeId],
  );

  const onAddNode = useCallback(
    (
      nodeType: NodeDataType,
      semanticId: string,
      simX?: number,
      simY?: number,
      viewId?: string,
    ): Promise<AddNodeResult> => {
      const position: AddNodePosition | undefined =
        simX !== undefined && simY !== undefined && viewId !== undefined
          ? { simX, simY, viewId }
          : undefined;
      return addNode(ports, nodeType, semanticId, position);
    },
    [ports],
  );

  const onCreateEdge = useCallback(
    (
      sourceIds: string[],
      targetId: string | null,
      x: number,
      y: number,
      setContextMenu: (menu: GraphContextMenuRequest) => void,
    ): Promise<EdgeId | null> =>
      createEdge(ports, sourceIds, targetId, x, y, setContextMenu),
    [ports],
  );

  const onDeleteEdge = useCallback(
    (edgeId: EdgeId) => deleteEdge(ports, edgeId),
    [ports],
  );

  const onDeleteSelected = useCallback(
    (nodeIds: string[], edgeIds: string[]) =>
      deleteSelected(ports, nodeIds, edgeIds),
    [ports],
  );

  const onChangeNodeSemantic = useCallback(
    (nodeId: NodeId, semanticId: string) =>
      changeNodeSemantic(ports, nodeId, semanticId),
    [ports],
  );

  const onChangeEdgeSemantic = useCallback(
    (edgeId: EdgeId, semanticId: string) =>
      changeEdgeSemantic(ports, edgeId, semanticId),
    [ports],
  );

  const onChangeEdgeDirection = useCallback(
    (edgeId: EdgeId, direction: EdgeDirection) =>
      changeEdgeDirection(ports, edgeId, direction),
    [ports],
  );

  return {
    onEditNode,
    onAddNode,
    onCreateEdge,
    onDeleteEdge,
    onDeleteSelected,
    onChangeEdgeDirection,
    onChangeEdgeSemantic,
    onChangeNodeSemantic,
  };
}
