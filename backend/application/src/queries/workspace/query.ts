// SPDX-License-Identifier: AGPL-3.0-only

export interface GetWorkspaceByIdQuery {
  id: string;
}

export interface ListWorkspacesQuery {
  userId?: string;
}

export interface ListUserWorkspacesQuery {
  userId: string;
}

export interface GetWorkspaceMembersQuery {
  workspaceId: string;
}
