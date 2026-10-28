// SPDX-License-Identifier: AGPL-3.0-only

import { Workspace, WorkspaceMember } from "../models/workspace";
import {
  WorkspaceId,
  WorkspaceMemberId,
} from "../models/workspace/value-objects";

// ============================================================
// IWorkspaceRepository - Workspace Aggregate
// ============================================================

export interface IWorkspaceRepository {
  findById(id: WorkspaceId): Promise<Workspace | null>;
  save(workspace: Workspace): Promise<Workspace>;
  delete(id: WorkspaceId): Promise<void>;
  findAll(): Promise<Workspace[]>;
  findByOwnerId(ownerId: string): Promise<Workspace[]>;
}

export interface IWorkspaceMemberRepository {
  findById(id: WorkspaceMemberId): Promise<WorkspaceMember | null>;
  save(member: WorkspaceMember): Promise<WorkspaceMember>;
  delete(id: WorkspaceMemberId): Promise<void>;
  findByWorkspaceId(workspaceId: WorkspaceId): Promise<WorkspaceMember[]>;
  findByUserId(userId: string): Promise<WorkspaceMember[]>;
  findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: string,
  ): Promise<WorkspaceMember | null>;
}
