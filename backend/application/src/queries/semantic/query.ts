// SPDX-License-Identifier: AGPL-3.0-only

// NodeSemantic queries
export interface GetNodeSemanticByIdQuery { id: string; }
export interface ListNodeSemanticsQuery { workspaceId?: string; }
export interface GetNodeSemanticByNameQuery { name: string; }
export interface GetNodeSemanticsByColorQuery { color: string; }

// EdgeSemantic queries
export interface GetEdgeSemanticByIdQuery { id: string; }
export interface ListEdgeSemanticsQuery { workspaceId?: string; }
export interface GetEdgeSemanticByNameQuery { name: string; }
export interface GetEdgeSemanticsByCategoryQuery { category: string; }

// NodeTag queries
export interface GetNodeTagByIdQuery { id: string; }
export interface ListNodeTagsQuery { workspaceId?: string; }
export interface GetNodeTagByNameQuery { name: string; }
export interface GetNodeTagsByIdsQuery { ids: string[]; }