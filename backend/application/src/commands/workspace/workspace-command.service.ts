// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IWorkspaceRepository,
  IWorkspaceMemberRepository,
  INodeRepository,
  IEdgeRepository,
  IViewRepository,
  INodeSemanticRepository,
  IEdgeSemanticRepository,
  INodeTagRepository,
  IEventBus,
} from "@workspace/domain";
import type {
  WorkspaceCreated,
  WorkspaceUpdated,
  WorkspaceDeleted,
  WorkspaceMemberAdded,
  WorkspaceMemberRemoved,
  ViewCreated,
} from "@workspace/domain";
import type {
  CreateWorkspaceCommand,
  UpdateWorkspaceCommand,
  DeleteWorkspaceCommand,
  AddWorkspaceMemberCommand,
  RemoveWorkspaceMemberCommand,
} from "./command";
import type { WorkspaceDTO, WorkspaceMemberDTO } from "../../dto/workspace.dto";
import { Workspace } from "@workspace/domain/models/workspace/entities";
import { WorkspaceMember } from "@workspace/domain/models/workspace/entities";
import { WorkspaceId } from "@workspace/domain/models/workspace/value-objects";
import { View } from "@workspace/domain/models/view/entities";
import {
  VisualConfig,
  ViewType,
} from "@workspace/domain/models/view/value-objects";
import { FilterConfig } from "@workspace/domain/models/filter/value-objects";
import {
  DEFAULT_VIEW_NAME,
  DEFAULT_WORKSPACE_NAME,
} from "@workspace/utils/workspace";

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

/**
 * Workspace command service.
 *
 * Deleting a workspace is a cascade by design: the workspace-scoped nodes,
 * edges, views, node semantics, edge semantics, node tags and member rows are
 * removed before the workspace row itself. There is no database transaction in
 * this layer, so the order is fixed: first the data that points into the
 * workspace, then the workspace.
 */
export class WorkspaceCommandService {
  constructor(
    private readonly workspaceRepository: IWorkspaceRepository,
    private readonly workspaceMemberRepository: IWorkspaceMemberRepository,
    private readonly nodeRepository: INodeRepository,
    private readonly edgeRepository: IEdgeRepository,
    private readonly viewRepository: IViewRepository,
    private readonly nodeSemanticRepository: INodeSemanticRepository,
    private readonly edgeSemanticRepository: IEdgeSemanticRepository,
    private readonly nodeTagRepository: INodeTagRepository,
    private readonly eventBus: IEventBus,
  ) {}

  /**
   * Provision a default workspace for a brand-new user on first login.
   *
   * Called when a user has zero workspaces. Creates an empty default
   * workspace with the user as owner + owner membership, plus a single
   * empty global view (no filterConfig → shows everything) so the graph has
   * something to render immediately after login. Both carry `isDefault`, so
   * neither can be deleted (a rename stays possible).
   *
   * Uses `tmp_`-prefixed IDs so the repositories create (not update) the
   * records; PocketBase assigns real IDs and the mappers map them back.
   * Returns the created workspace DTO.
   */
  async provisionDefaultWorkspace(userId: string): Promise<WorkspaceDTO> {
    const workspaceId = `tmp_${crypto.randomUUID()}`;
    const memberId = `tmp_${crypto.randomUUID()}`;
    const viewId = `tmp_${crypto.randomUUID()}`;

    const workspace = Workspace.create({
      id: workspaceId,
      name: DEFAULT_WORKSPACE_NAME,
      ownerId: userId,
      isDefault: true,
    });
    const saved = await this.workspaceRepository.save(workspace);

    const member = WorkspaceMember.create({
      id: memberId,
      workspaceId: saved.id.value,
      userId,
      role: "owner",
    });
    await this.workspaceMemberRepository.save(member);

    const view = View.create({
      id: viewId,
      name: DEFAULT_VIEW_NAME,
      viewType: ViewType.force(),
      visualConfig: VisualConfig.create({ showMinimap: true }),
      filterConfig: FilterConfig.empty(),
      isPinned: true,
      isDefault: true,
      workspaceId: saved.id.value,
    });
    const savedView = await this.viewRepository.save(view);

    const createdEvent: WorkspaceCreated = {
      eventType: "WorkspaceCreated",
      aggregateId: saved.id.value,
      metadata: {
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId,
      },
      data: {
        id: saved.id.value,
      },
    };
    this.eventBus.publish(createdEvent);

    const viewCreatedEvent: ViewCreated = {
      eventType: "ViewCreated",
      aggregateId: savedView.id.value,
      metadata: {
        workspaceId: saved.id.value,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId,
      },
      data: {
        id: savedView.id.value,
      },
    };
    this.eventBus.publish(viewCreatedEvent);

    return toWorkspaceDTO(saved);
  }

  async createWorkspace(cmd: CreateWorkspaceCommand): Promise<WorkspaceDTO> {
    const workspace = Workspace.create({
      id: cmd.id,
      name: cmd.name,
      ownerId: cmd.ownerId,
      icon: cmd.icon,
      isDefault: false,
    });

    const saved = await this.workspaceRepository.save(workspace);

    const event: WorkspaceCreated = {
      eventType: "WorkspaceCreated",
      aggregateId: saved.id.value,
      metadata: {
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.value,
      },
    };
    this.eventBus.publish(event);

    // Invariant: every workspace must have at least one global view
    // (empty filterConfig → shows everything). Mirror the default-provision
    // path so a workspace created via createWorkspace is immediately renderable.
    const viewId = `tmp_${crypto.randomUUID()}`;
    const view = View.create({
      id: viewId,
      name: DEFAULT_VIEW_NAME,
      viewType: ViewType.force(),
      visualConfig: VisualConfig.create({ showMinimap: true }),
      filterConfig: FilterConfig.empty(),
      isPinned: true,
      isDefault: true,
      workspaceId: saved.id.value,
    });
    const savedView = await this.viewRepository.save(view);

    const viewCreatedEvent: ViewCreated = {
      eventType: "ViewCreated",
      aggregateId: savedView.id.value,
      metadata: {
        workspaceId: saved.id.value,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: savedView.id.value,
      },
    };
    this.eventBus.publish(viewCreatedEvent);

    return toWorkspaceDTO(saved);
  }

  /**
   * Rename a workspace and/or change its icon.
   *
   * The application layer repeats the owner check even though the PocketBase
   * rules also deny a non-owner: live mode and the desktop local mode must
   * enforce the same rule, and a repository rule is not a use-case invariant.
   */
  async updateWorkspace(cmd: UpdateWorkspaceCommand): Promise<WorkspaceDTO> {
    const id = WorkspaceId.create(cmd.id);
    const workspace = await this.workspaceRepository.findById(id);

    if (!workspace) {
      throw new Error(`Workspace not found: ${cmd.id}`);
    }
    if (workspace.ownerId !== cmd.userId) {
      throw new Error("Only the workspace owner can rename it");
    }

    let updated = workspace;

    if (cmd.name !== undefined) {
      updated = updated.updateName(cmd.name);
    }
    if (cmd.icon !== undefined) {
      updated = updated.updateIcon(cmd.icon);
    }

    const saved = await this.workspaceRepository.save(updated);

    const event: WorkspaceUpdated = {
      eventType: "WorkspaceUpdated",
      aggregateId: saved.id.value,
      metadata: {
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.value,
      },
    };
    this.eventBus.publish(event);

    return toWorkspaceDTO(saved);
  }

  /**
   * Delete a workspace and every row that belongs to it.
   *
   * Cascade order: nodes, edges, views, node semantics, edge semantics, node
   * tags, members, then the workspace itself. No transaction exists in this
   * layer, so each step is ordered so that a partial failure leaves the
   * workspace in place and a retry can finish the cleanup.
   */
  async deleteWorkspace(cmd: DeleteWorkspaceCommand): Promise<void> {
    const id = WorkspaceId.create(cmd.id);

    const workspace = await this.workspaceRepository.findById(id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${cmd.id}`);
    }
    if (workspace.ownerId !== cmd.userId) {
      throw new Error("Only the workspace owner can delete it");
    }
    if (workspace.isDefault) {
      throw new Error("The default workspace cannot be deleted");
    }

    // Cascade-delete all workspace-scoped data so no orphaned rows linger after
    // the workspace is gone.
    const nodes = await this.nodeRepository.findAll({ workspaceId: id.value });
    if (nodes.length > 0) {
      await this.nodeRepository.deleteMany(nodes.map((n) => n.id));
    }
    const edges = await this.edgeRepository.findAll({ workspaceId: id.value });
    if (edges.length > 0) {
      await this.edgeRepository.deleteMany(edges.map((e) => e.id));
    }
    const views = await this.viewRepository.findAll({ workspaceId: id.value });
    if (views.length > 0) {
      await this.viewRepository.deleteMany(views.map((v) => v.id));
    }

    // Semantics and tags have no `deleteMany` port, so they are deleted one by
    // one. They carry a `workspaceId` and would otherwise survive as orphans.
    const nodeSemantics = await this.nodeSemanticRepository.findAll({
      workspaceId: id.value,
    });
    for (const semantic of nodeSemantics) {
      await this.nodeSemanticRepository.delete(semantic.id);
    }
    const edgeSemantics = await this.edgeSemanticRepository.findAll({
      workspaceId: id.value,
    });
    for (const semantic of edgeSemantics) {
      await this.edgeSemanticRepository.delete(semantic.id);
    }
    const nodeTags = await this.nodeTagRepository.findAll({
      workspaceId: id.value,
    });
    for (const tag of nodeTags) {
      await this.nodeTagRepository.delete(tag.id);
    }

    // Delete all members of the workspace.
    const members = await this.workspaceMemberRepository.findByWorkspaceId(id);
    for (const member of members) {
      await this.workspaceMemberRepository.delete(member.id);
    }

    await this.workspaceRepository.delete(id);

    const event: WorkspaceDeleted = {
      eventType: "WorkspaceDeleted",
      aggregateId: id.value,
      metadata: {
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: id.value,
      },
    };
    this.eventBus.publish(event);
  }

  async addMember(cmd: AddWorkspaceMemberCommand): Promise<WorkspaceMemberDTO> {
    const member = WorkspaceMember.create({
      id: cmd.id,
      workspaceId: cmd.workspaceId,
      userId: cmd.userId,
      role: cmd.role,
    });

    const saved = await this.workspaceMemberRepository.save(member);

    const event: WorkspaceMemberAdded = {
      eventType: "WorkspaceMemberAdded",
      aggregateId: saved.workspaceId.value,
      metadata: {
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.actorUserId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.value,
        workspaceId: saved.workspaceId.value,
        userId: saved.userId,
      },
    };
    this.eventBus.publish(event);

    return toWorkspaceMemberDTO(saved);
  }

  async removeMember(cmd: RemoveWorkspaceMemberCommand): Promise<void> {
    const workspaceId = WorkspaceId.create(cmd.workspaceId);

    const member = await this.workspaceMemberRepository.findByWorkspaceAndUser(
      workspaceId,
      cmd.userId,
    );

    if (!member) {
      throw new Error(
        `WorkspaceMember not found: workspace=${cmd.workspaceId} user=${cmd.userId}`,
      );
    }

    await this.workspaceMemberRepository.delete(member.id);

    const event: WorkspaceMemberRemoved = {
      eventType: "WorkspaceMemberRemoved",
      aggregateId: workspaceId.value,
      metadata: {
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.actorUserId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: member.id.value,
        workspaceId: workspaceId.value,
        userId: member.userId,
      },
    };
    this.eventBus.publish(event);
  }
}
