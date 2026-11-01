// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The operation catalogue the client writes through (plan item 37, §5.1.9).
 *
 * Operation ids and their target kind, effect and resource live here once, so a
 * call site names an operation through a typed helper instead of concatenating
 * an id. The ids are the ones `plugins/builtin/server/{type,graph}-operations.ts`
 * registers and `apps/server/src/operation-registry.ts` binds.
 */
import type {
  EdgeData,
  EdgeDirection,
  EdgeId,
  EdgeStateData,
  FilterConfig,
  NodeData,
  NodeId,
  NodeStateData,
  View,
  ViewId,
  ViewType,
  VisualConfig,
} from "@workspace/interfaces";
import {
  asOperationInvokeError,
  invokeOperation,
  type OperationInvokeBody,
  type OperationInvoker,
  type OperationResult,
  type OperationTarget,
} from "@workspace/api-client";
import { useDataStore, useWorkspaceStore } from "@workspace/store";

export const NODE_OPERATIONS = {
  add: "node.add",
  setTitle: "node.setTitle",
  setAbstract: "node.setAbstract",
  setSemanticId: "node.setSemanticId",
  setStateData: "node.setStateData",
  pin: "node.pin",
  unpin: "node.unpin",
} as const;

export const EDGE_OPERATIONS = {
  create: "edge.create",
  setLabel: "edge.setLabel",
  setSemanticId: "edge.setSemanticId",
  setDirection: "edge.setDirection",
  delete: "edge.delete",
} as const;

export const VIEW_OPERATIONS = {
  create: "view.create",
  setLayout: "view.setLayout",
  setFilter: "view.setFilter",
  delete: "view.delete",
} as const;

type OperationResource = "node" | "edge" | "view";
type OperationEffect = "create" | "update" | "delete";

interface GraphOperationDefinition {
  readonly target: OperationTarget["kind"];
  readonly effect: OperationEffect;
  readonly resource: OperationResource;
}

/**
 * Every operation the client may invoke, with what the store must do after it.
 *
 * `resource` and `effect` are the only facts the reply does not carry for a
 * delete, where the server has no snapshot to reload.
 */
export const GRAPH_OPERATIONS = {
  [NODE_OPERATIONS.add]: {
    target: "workspace",
    effect: "create",
    resource: "node",
  },
  [NODE_OPERATIONS.setTitle]: {
    target: "node",
    effect: "update",
    resource: "node",
  },
  [NODE_OPERATIONS.setAbstract]: {
    target: "node",
    effect: "update",
    resource: "node",
  },
  [NODE_OPERATIONS.setSemanticId]: {
    target: "node",
    effect: "update",
    resource: "node",
  },
  [NODE_OPERATIONS.setStateData]: {
    target: "node",
    effect: "update",
    resource: "node",
  },
  [NODE_OPERATIONS.pin]: { target: "node", effect: "update", resource: "node" },
  [NODE_OPERATIONS.unpin]: {
    target: "node",
    effect: "update",
    resource: "node",
  },
  [EDGE_OPERATIONS.create]: {
    target: "workspace",
    effect: "create",
    resource: "edge",
  },
  [EDGE_OPERATIONS.setLabel]: {
    target: "edge",
    effect: "update",
    resource: "edge",
  },
  [EDGE_OPERATIONS.setSemanticId]: {
    target: "edge",
    effect: "update",
    resource: "edge",
  },
  [EDGE_OPERATIONS.setDirection]: {
    target: "edge",
    effect: "update",
    resource: "edge",
  },
  [EDGE_OPERATIONS.delete]: {
    target: "edge",
    effect: "delete",
    resource: "edge",
  },
  [VIEW_OPERATIONS.create]: {
    target: "workspace",
    effect: "create",
    resource: "view",
  },
  [VIEW_OPERATIONS.setLayout]: {
    target: "view",
    effect: "update",
    resource: "view",
  },
  [VIEW_OPERATIONS.setFilter]: {
    target: "view",
    effect: "update",
    resource: "view",
  },
  [VIEW_OPERATIONS.delete]: {
    target: "view",
    effect: "delete",
    resource: "view",
  },
} as const satisfies Record<string, GraphOperationDefinition>;

export type GraphOperationId = keyof typeof GRAPH_OPERATIONS;

/** Typed inputs of the node operations the UI uses. */
export interface NodeOperationInput {
  "node.add": { nodeType: string };
  "node.setTitle": { title: string };
  "node.setAbstract": { abstract: string };
  "node.setSemanticId": { semanticId: string };
  "node.setStateData": { stateData: NodeStateData };
  "node.pin": Record<string, never>;
  "node.unpin": Record<string, never>;
}

interface EdgeCreateInput {
  from: NodeId;
  to: NodeId;
  semanticId: string;
  direction: EdgeDirection;
  stateData?: EdgeStateData;
}

/** Typed inputs of the edge operations the UI uses. */
export interface EdgeOperationInput {
  "edge.create": EdgeCreateInput;
  "edge.setLabel": { label: string };
  "edge.setSemanticId": { semanticId: string };
  "edge.setDirection": { direction: EdgeDirection };
  "edge.delete": Record<string, never>;
}

interface ViewCreateInput {
  name: string;
  viewType: ViewType;
  visualConfig?: VisualConfig;
  filterConfig?: FilterConfig;
  isPinned?: boolean;
}

/** Typed inputs of the view operations the UI uses. */
export interface ViewOperationInput {
  "view.create": ViewCreateInput;
  "view.setLayout": { visualConfig: VisualConfig };
  "view.setFilter": { filterConfig: FilterConfig };
  "view.delete": Record<string, never>;
}

export interface GraphInvokeOptions {
  /** Optimistic check: the `updatedAt` of the record the caller last saw. */
  expectedVersion?: string;
  correlationId?: string;
  /** Test seam; a real caller uses the tRPC route. */
  invoker?: OperationInvoker;
}

/**
 * The workspace a create operation targets.
 *
 * The server takes the workspace from the connection, so a missing selection is
 * a client-side error rather than a request the server would have to refuse.
 */
export function workspaceTarget(): OperationTarget {
  const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  if (workspaceId === null || workspaceId === "") {
    throw new Error(
      "A graph write needs an active workspace; none is selected.",
    );
  }
  return { kind: "workspace", workspaceId };
}

export function nodeTarget(nodeId: NodeId): OperationTarget {
  return { kind: "node", nodeId };
}

export function edgeTarget(edgeId: EdgeId): OperationTarget {
  return { kind: "edge", edgeId };
}

export function viewTarget(viewId: ViewId): OperationTarget {
  return { kind: "view", viewId };
}

function idOfTarget(target: OperationTarget): string {
  switch (target.kind) {
    case "workspace":
      return target.workspaceId;
    case "node":
      return target.nodeId;
    case "edge":
      return target.edgeId;
    case "view":
      return target.viewId;
  }
}

/**
 * Writes the canonical snapshot the executor reloaded, and nothing else.
 *
 * A success whose reply carries no snapshot (a delete) removes the addressed
 * record; a refusal never reaches this function, so a failed invoke cannot
 * leave a half-written store behind.
 */
function applyOperationResult(
  operationId: GraphOperationId,
  target: OperationTarget,
  result: OperationResult,
): void {
  const definition: GraphOperationDefinition | undefined =
    GRAPH_OPERATIONS[operationId];
  const store = useDataStore.getState();

  if (result.node !== undefined) {
    store.upsertNode(result.node as unknown as NodeData);
  }
  if (result.edge !== undefined) {
    store.upsertEdge(result.edge as unknown as EdgeData);
  }
  if (result.view !== undefined) {
    store.upsertView(result.view as unknown as View);
  }
  if (definition === undefined || definition.effect !== "delete") return;

  const id = idOfTarget(target);
  if (definition.resource === "node") store.deleteNode(id);
  else if (definition.resource === "edge") store.deleteEdge(id);
  else store.deleteView(id);
}

/**
 * The single client write entry: one `operation.invoke`, then the store update.
 *
 * This is what `NodeService.invoke` exposes; the edge and view services call
 * the same function, so there is one request shape and one apply rule.
 */
export async function invokeGraphOperation(
  operationId: GraphOperationId,
  target: OperationTarget,
  input: unknown,
  options?: GraphInvokeOptions,
): Promise<OperationResult> {
  const invoker = options?.invoker ?? invokeOperation;
  const body: OperationInvokeBody = {
    operationId,
    target,
    input,
    ...(options?.expectedVersion === undefined
      ? {}
      : { expectedVersion: options.expectedVersion }),
    ...(options?.correlationId === undefined
      ? {}
      : { correlationId: options.correlationId }),
  };

  let result: OperationResult;
  try {
    result = await invoker(body);
  } catch (error) {
    throw asOperationInvokeError(error);
  }

  applyOperationResult(operationId, target, result);
  return result;
}
