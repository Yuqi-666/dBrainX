// SPDX-License-Identifier: AGPL-3.0-only

import {
  Dashboard,
  DashboardAccessError,
  DashboardValidationError,
  NodeId,
  WorkspaceId,
} from "@workspace/domain";
import type {
  IDashboardRepository,
  IWorkspaceRepository,
  IWorkspaceMemberRepository,
  INodeRepository,
  IEventBus,
} from "@workspace/domain";
import type { DashboardWorkspace } from "@workspace/interfaces";

/** The access check is shared with reads and subscription delivery. */
export async function assertDashboardAccess(
  workspaces: IWorkspaceRepository,
  members: IWorkspaceMemberRepository,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const id = WorkspaceId.create(workspaceId);
  const workspace = await workspaces.findById(id);
  if (
    !workspace ||
    (workspace.ownerId !== userId &&
      !(await members.findByWorkspaceAndUser(id, userId)))
  )
    throw new DashboardAccessError("Workspace access denied");
}

export class DashboardCommandService {
  constructor(
    private readonly dashboards: IDashboardRepository,
    private readonly workspaces: IWorkspaceRepository,
    private readonly members: IWorkspaceMemberRepository,
    private readonly nodes: INodeRepository,
    private readonly events: IEventBus,
  ) {}

  async save(command: {
    workspaceId: string;
    userId: string;
    state: DashboardWorkspace;
    sourceId?: string;
  }): Promise<DashboardWorkspace> {
    const { workspaceId, userId, state } = command;
    await assertDashboardAccess(
      this.workspaces,
      this.members,
      workspaceId,
      userId,
    );
    const previous =
      (await this.dashboards.findLatest(workspaceId, userId)) ??
      Dashboard.create(workspaceId, userId, {
        candidates: [],
        pages: [],
        activePageId: null,
        revision: 0,
      });
    const next = previous.replace(state);
    const old = previous.toDTO();
    const existingReferences = new Set([
      ...old.candidates,
      ...old.pages.flatMap((page) =>
        page.widgets.map((widget) => widget.nodeId),
      ),
    ]);
    const references = new Set([
      ...state.candidates,
      ...state.pages.flatMap((page) =>
        page.widgets.map((widget) => widget.nodeId),
      ),
    ]);
    // Removed nodes may remain as removable placeholders. New references must be in this workspace.
    for (const nodeId of references) {
      if (existingReferences.has(nodeId)) continue;
      const node = await this.nodes.findById(new NodeId(nodeId));
      if (!node || node.workspaceId !== workspaceId)
        throw new DashboardValidationError(
          "Dashboard node does not belong to this workspace",
        );
    }
    const previousWidgets = new Set(
      old.pages.flatMap((page) =>
        page.widgets.map((widget) =>
          JSON.stringify([page.id, widget.id, widget.nodeId]),
        ),
      ),
    );
    for (const page of state.pages)
      for (const widget of page.widgets) {
        if (
          !previousWidgets.has(
            JSON.stringify([page.id, widget.id, widget.nodeId]),
          ) &&
          !state.candidates.includes(widget.nodeId)
        )
          throw new DashboardValidationError(
            "Add the node to dashboard candidates first",
          );
      }
    const saved = await this.dashboards.save(next);
    this.events.publish({
      eventType: "DashboardUpdated",
      aggregateId: workspaceId,
      metadata: {
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId,
        sourceId: command.sourceId,
      },
      data: { workspaceId, revision: saved.toDTO().revision },
    });
    return saved.toDTO();
  }
}
