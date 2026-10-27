// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeIcon } from "../node/base";

export type WorkspaceId = string;
export interface Workspace {
  id: WorkspaceId;
  name: string;
  ownerId: string;
  /**
   * The icon the workspace picker shows in front of the name.
   *
   * Only the `emoji` and `icon` kinds are accepted: a workspace has no file of
   * its own to upload an image to. `null` is the write-side "clear" sentinel and
   * `undefined` means "leave the stored icon alone".
   */
  icon?: NodeIcon | null;
  /**
   * True for the workspace the server provisions on a user's first login.
   * A default workspace cannot be deleted; other workspaces can.
   */
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
export type WorkspaceMemberId = string;
export type WorkspaceRole = "owner" | "editor" | "viewer";
export interface WorkspaceMember {
  id: WorkspaceMemberId;
  workspaceId: WorkspaceId;
  userId: string;
  role: WorkspaceRole;
  createdAt?: string;
}
