// SPDX-License-Identifier: AGPL-3.0-only

export interface GetEdgeByIdQuery {
  id: string;
}

export interface ListEdgesQuery {
  from?: string;
  to?: string;
  semanticId?: string;
  direction?: "forward" | "reverse" | "bidirectional" | "undirected";
  workspaceId?: string;
}

export interface GetEdgesByNodeQuery {
  nodeId: string;
}

export interface GetEdgesByEndpointsQuery {
  from: string;
  to: string;
}

export interface GetEdgesByIdsQuery {
  ids: string[];
}
