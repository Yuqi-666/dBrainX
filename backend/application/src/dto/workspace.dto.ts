// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeIcon } from "@workspace/interfaces";

export interface WorkspaceDTO {
  id: string;
  name: string;
  ownerId: string;
  /** Display icon; omitted when the workspace has none. */
  icon?: NodeIcon;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspaceMemberDTO {
  id: string;
  workspaceId: string;
  userId: string;
  role: "owner" | "editor" | "viewer";
  createdAt?: string;
}
