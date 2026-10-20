// SPDX-License-Identifier: AGPL-3.0-only

export interface GetNodeByIdQuery {
  id: string;
}

export interface ListNodesQuery {
  nodeType?: string;
  semanticId?: string;
  tags?: string[];
  isPinned?: boolean;
  searchTerm?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  permission?: 'private' | 'public' | 'restricted';
  workspaceId?: string;
}

export interface GetNodesByIdsQuery {
  ids: string[];
}

export interface GetPinnedNodesQuery {}

export interface GetRecentlyUpdatedNodesQuery {
  limit: number;
}