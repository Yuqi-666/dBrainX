// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The gestures `useGraph` exposes, as plain functions over injected ports.
 *
 * A gesture turns one pointer interaction into invocations and UI calls. It
 * never builds a node or an edge and never touches a store directly, which is
 * what lets the write half be asserted against an injected invoker.
 */

import type {
  EdgeData,
  EdgeDirection,
  EdgeId,
  NodeData,
  NodeDataType,
  NodeId,
  NodeStateData,
} from "@workspace/interfaces";

import type {
  GraphOperationInvocation,
  GraphOperationInvoker,
  GraphOperationTarget,
} from "./graph-operations.ts";

export interface GraphWriteFailure {
  readonly operationId: string;
  readonly error: unknown;
}

export interface GraphContextMenuRequest {
  readonly x: number;
  readonly y: number;
  readonly visible: true;
  readonly type: "add-edge" | "edge";
  readonly context:
    | { readonly sourceIds: string[]; readonly targetId: string | null }
    | { readonly edgeId: EdgeId };
}

export interface GraphGesturePorts {
  readonly invoke: GraphOperationInvoker;
  readonly createEdge: (input: {
    readonly from: NodeId;
    readonly to: NodeId;
    readonly direction: EdgeDirection;
  }) => Promise<EdgeData>;
  readonly currentWorkspaceId: string | null;
  readonly openNodeEditor: (nodeId: NodeId) => void;
  readonly reportFailure: (failure: GraphWriteFailure) => void;
}

export interface AddNodeResult {
  readonly nodeId: NodeId | null;
  readonly failures: readonly GraphWriteFailure[];
}

export interface AddNodePosition {
  readonly simX: number;
  readonly simY: number;
  readonly viewId: string;
}

export function newCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}

function workspaceTarget(workspaceId: string): GraphOperationTarget {
  return { kind: "workspace", workspaceId };
}

function nodeTarget(nodeId: NodeId): GraphOperationTarget {
  return { kind: "node", nodeId };
}

function edgeTarget(edgeId: EdgeId): GraphOperationTarget {
  return { kind: "edge", edgeId };
}

async function runStep(
  ports: GraphGesturePorts,
  failures: GraphWriteFailure[],
  invocation: GraphOperationInvocation,
): Promise<void> {
  try {
    await ports.invoke(invocation);
  } catch (error) {
    const failure = { operationId: invocation.operationId, error };
    failures.push(failure);
    ports.reportFailure(failure);
  }
}

/**
 * One intent, three invocations: `node.add` (the server supplies the id and
 * the type defaults), then `node.setSemanticId` and `node.setStateData` when
 * the gesture carries them. All three share one correlation id, and a failing
 * follow-up keeps the node that `node.add` already created.
 */
export async function addNode(
  ports: GraphGesturePorts,
  nodeType: NodeDataType,
  semanticId: string,
  position?: AddNodePosition,
): Promise<AddNodeResult> {
  const correlationId = newCorrelationId();
  const workspaceId = ports.currentWorkspaceId;
  if (workspaceId === null) {
    const failure: GraphWriteFailure = {
      operationId: "node.add",
      error: new Error("node.add needs an active workspace"),
    };
    ports.reportFailure(failure);
    return { nodeId: null, failures: [failure] };
  }

  let created: NodeData;
  try {
    const result = await ports.invoke({
      operationId: "node.add",
      target: workspaceTarget(workspaceId),
      input: { nodeType },
      correlationId,
    });
    if (result.node === undefined) throw new Error("node.add returned no node");
    created = result.node;
  } catch (error) {
    const failure: GraphWriteFailure = { operationId: "node.add", error };
    ports.reportFailure(failure);
    return { nodeId: null, failures: [failure] };
  }

  const failures: GraphWriteFailure[] = [];
  ports.openNodeEditor(created.id);

  if (semanticId !== "") {
    await runStep(ports, failures, {
      operationId: "node.setSemanticId",
      target: nodeTarget(created.id),
      input: { semanticId },
      correlationId,
    });
  }

  if (position !== undefined) {
    const stateData: NodeStateData = {
      client: {
        position: [
          {
            viewId: position.viewId,
            x: position.simX,
            y: position.simY,
            mode: "force",
          },
        ],
      },
      server: {},
    };
    await runStep(ports, failures, {
      operationId: "node.setStateData",
      target: nodeTarget(created.id),
      input: { stateData },
      correlationId,
    });
  }

  return { nodeId: created.id, failures };
}

export async function createEdge(
  ports: GraphGesturePorts,
  sourceIds: string[],
  targetId: string | null,
  x: number,
  y: number,
  setContextMenu: (menu: GraphContextMenuRequest) => void,
): Promise<EdgeId | null> {
  if (targetId === null) {
    setContextMenu({
      x,
      y,
      type: "add-edge",
      context: { sourceIds, targetId },
      visible: true,
    });
    return null;
  }

  let firstEdgeId: EdgeId | null = null;
  for (const sourceId of sourceIds) {
    if (sourceId === targetId) continue;
    try {
      const created = await ports.createEdge({
        from: sourceId as NodeId,
        to: targetId as NodeId,
        direction: "forward",
      });
      if (firstEdgeId === null) firstEdgeId = created.id;
    } catch (error) {
      ports.reportFailure({ operationId: "edge.create", error });
    }
  }

  if (firstEdgeId !== null) {
    setContextMenu({
      x,
      y,
      type: "edge",
      context: { edgeId: firstEdgeId },
      visible: true,
    });
  }
  return firstEdgeId;
}

export async function deleteEdge(
  ports: GraphGesturePorts,
  edgeId: EdgeId,
): Promise<void> {
  await runStep(ports, [], {
    operationId: "edge.delete",
    target: edgeTarget(edgeId),
    input: {},
    correlationId: newCorrelationId(),
  });
}

export async function deleteSelected(
  ports: GraphGesturePorts,
  nodeIds: string[],
  edgeIds: string[],
): Promise<void> {
  const correlationId = newCorrelationId();
  for (const edgeId of edgeIds) {
    await runStep(ports, [], {
      operationId: "edge.delete",
      target: edgeTarget(edgeId as EdgeId),
      input: {},
      correlationId,
    });
  }
  for (const nodeId of nodeIds) {
    await runStep(ports, [], {
      operationId: "node.delete",
      target: nodeTarget(nodeId as NodeId),
      input: {},
      correlationId,
    });
  }
}

export async function changeNodeSemantic(
  ports: GraphGesturePorts,
  nodeId: NodeId,
  semanticId: string,
): Promise<void> {
  await runStep(ports, [], {
    operationId: "node.setSemanticId",
    target: nodeTarget(nodeId),
    input: { semanticId },
    correlationId: newCorrelationId(),
  });
}

export async function changeEdgeSemantic(
  ports: GraphGesturePorts,
  edgeId: EdgeId,
  semanticId: string,
): Promise<void> {
  await runStep(ports, [], {
    operationId: "edge.setSemanticId",
    target: edgeTarget(edgeId),
    input: { semanticId },
    correlationId: newCorrelationId(),
  });
}

export async function changeEdgeDirection(
  ports: GraphGesturePorts,
  edgeId: EdgeId,
  direction: EdgeDirection,
): Promise<void> {
  await runStep(ports, [], {
    operationId: "edge.setDirection",
    target: edgeTarget(edgeId),
    input: { direction },
    correlationId: newCorrelationId(),
  });
}
