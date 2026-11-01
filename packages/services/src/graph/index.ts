// SPDX-License-Identifier: AGPL-3.0-only

export { NodeService } from "./node.service";
export { EdgeService } from "./edge.service";
export { ViewService } from "./view.service";
export {
  EDGE_OPERATIONS,
  GRAPH_OPERATIONS,
  NODE_OPERATIONS,
  VIEW_OPERATIONS,
  invokeGraphOperation,
  nodeTarget,
  edgeTarget,
  viewTarget,
  workspaceTarget,
} from "./operations";
export type {
  EdgeOperationInput,
  GraphInvokeOptions,
  GraphOperationId,
  NodeOperationInput,
  ViewOperationInput,
} from "./operations";
export { WorkspaceService } from "./workspace.service";
export { NodeSemanticService } from "./node-semantic.service";
export { EdgeSemanticService } from "./edge-semantic.service";
export { NodeTagService } from "./node-tag.service";
export {
  syncViewEnumerationOnCreate,
  syncViewEnumerationOnDelete,
} from "./view-enum-sync";

export { DashboardService } from "./dashboard.service";
