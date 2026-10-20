// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeId } from "../node/base";

export type EdgeDirection =
  | "forward"
  | "reverse"
  | "bidirectional"
  | "undirected";

export type EdgeType = "hierarchy" | "flow" | "association" | "interaction";

export type EdgeSemanticId = string;

export type EdgeId = string;
export type EdgeWeight = 1 | 2 | 3 | 4 | 5; //数字越小关系越近
export interface EdgeSemantic {
  id: EdgeSemanticId;
  name: string;
  category: EdgeType;
  color?: string;
  icon?: string;
  description?: string;
  workspaceId?: string;
}

export interface EdgeClientStyle {
  strokeColor?: string;
  strokeWidth?: number;
  labelColor?: string;
  labelSize?: number;
  shape?: "straight" | "curve" | "s-curve";
  strokeType?: "solid" | "dotted" | "dashed";
}

export interface EdgeClientState {
  style?: EdgeClientStyle;
  [key: string]: unknown;
}

export interface EdgeServerState {
  label?: string;
  weight?: EdgeWeight;
  [key: string]: unknown;
}

export interface EdgeStateData {
  client: EdgeClientState;
  server: EdgeServerState;
}

export interface EdgeBase {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  direction: EdgeDirection;
  semanticId: EdgeSemanticId;
  stateData?: EdgeStateData;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EdgeData extends EdgeBase {}
