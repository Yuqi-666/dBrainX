// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IWorkspaceRepository,
  IWorkspaceMemberRepository,
} from "@workspace/domain";
import type { Workspace, WorkspaceMember } from "@workspace/domain";
import { WorkspaceId } from "@workspace/domain/models/workspace/value-objects";
import type {
  GetWorkspaceByIdQuery,
  ListWorkspacesQuery,
  ListUserWorkspacesQuery,
  GetWorkspaceMembersQuery,
} from "./query";
import type { WorkspaceDTO, WorkspaceMemberDTO } from "../../dto/workspace.dto";

function toWorkspaceDTO(workspace: Workspace): WorkspaceDTO {
  return {
    id: workspace.id.value,
    name: workspace.name,
    ownerId: workspace.ownerId,
    icon: workspace.icon,
    isDefault: workspace.isDefault,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

function toWorkspaceMemberDTO(member: WorkspaceMember): WorkspaceMemberDTO {
  return {
    id: member.id.value,
    workspaceId: member.workspaceId.value,
    userId: member.userId,
    role: member.role,
    createdAt: member.createdAt,
  };
}

export class WorkspaceQueryService {
  constructor(
    private readonly workspaceRepository: IWorkspaceRepository,
    private readonly workspaceMemberRepository: IWorkspaceMemberRepository,
  ) { }

  async getById(q: GetWorkspaceByIdQuery): Promise<WorkspaceDTO | null> {
    const workspace = await this.workspaceRepository.findById(
      WorkspaceId.create(q.id),
    );
    return workspace ? toWorkspaceDTO(workspace) : null;
  }

  async list(q: ListWorkspacesQuery): Promise<WorkspaceDTO[]> {
    const items = await this.workspaceRepository.findAll();
    return items.map(toWorkspaceDTO);
  }

  async listByUser(q: ListUserWorkspacesQuery): Promise<WorkspaceDTO[]> {
    const owned = await this.workspaceRepository.findByOwnerId(q.userId);

    const memberships = await this.workspaceMemberRepository.findByUserId(
      q.userId,
    );
    const sharedWorkspaceIds = new Set(
      memberships.map((member) => member.workspaceId.value),
    );
    const shared: Workspace[] = [];
    for (const workspaceId of sharedWorkspaceIds) {
      const workspace = await this.workspaceRepository.findById(
        WorkspaceId.create(workspaceId),
      );
      if (workspace) {
        shared.push(workspace);
      }
    }

    // Deduplicate by id — a user can both own and be a member of a workspace.
    const seen = new Set<string>();
    const result: WorkspaceDTO[] = [];
    for (const workspace of [...owned, ...shared]) {
      const id = workspace.id.value;
      if (!seen.has(id)) {
        seen.add(id);
        result.push(toWorkspaceDTO(workspace));
      }
    }
    return result;
  }

  async getMembers(q: GetWorkspaceMembersQuery): Promise<WorkspaceMemberDTO[]> {
    const members = await this.workspaceMemberRepository.findByWorkspaceId(
      WorkspaceId.create(q.workspaceId),
    );
    return members.map(toWorkspaceMemberDTO);
  }
}
