// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeIcon } from "@workspace/interfaces";

export interface CreateWorkspaceCommand {
  id: string;
  name: string;
  ownerId: string;
  /** Optional picker icon; `null` is stored as "no icon". */
  icon?: NodeIcon | null;
  userId: string;
  sourceId?: string;
}

export interface UpdateWorkspaceCommand {
  id: string;
  name?: string;
  /**
   * `undefined` leaves the stored icon alone; `null` clears it. Same sentinel
   * as the node update contract.
   */
  icon?: NodeIcon | null;
  userId: string;
  sourceId?: string;
}

export interface DeleteWorkspaceCommand {
  id: string;
  userId: string;
  sourceId?: string;
}

export interface AddWorkspaceMemberCommand {
  id: string;
  workspaceId: string;
  userId: string;
  role: "owner" | "editor" | "viewer";
  actorUserId: string;
  sourceId?: string;
}

export interface RemoveWorkspaceMemberCommand {
  id: string;
  workspaceId: string;
  userId: string;
  actorUserId: string;
  sourceId?: string;
}
