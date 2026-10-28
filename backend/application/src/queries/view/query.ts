// SPDX-License-Identifier: AGPL-3.0-only

export interface GetViewByIdQuery {
  id: string;
}

export interface ListViewsQuery {
  isPinned?: boolean;
  viewType?: string;
  workspaceId?: string;
}

export interface GetViewsByNodeQuery {
  nodeId: string;
}

export interface GetPinnedViewsQuery {}