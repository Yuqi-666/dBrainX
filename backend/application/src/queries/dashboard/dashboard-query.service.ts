// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IDashboardRepository,
  IWorkspaceRepository,
  IWorkspaceMemberRepository,
} from "@workspace/domain";
import type { DashboardWorkspace } from "@workspace/interfaces";
import { assertDashboardAccess } from "../../commands/dashboard/dashboard-command.service";

export class DashboardQueryService {
  constructor(
    private readonly dashboards: IDashboardRepository,
    private readonly workspaces: IWorkspaceRepository,
    private readonly members: IWorkspaceMemberRepository,
  ) {}
  async get(query: {
    workspaceId: string;
    userId: string;
  }): Promise<DashboardWorkspace> {
    await this.assertAccess(query);
    const dashboard = await this.dashboards.findLatest(
      query.workspaceId,
      query.userId,
    );
    return (
      dashboard?.toDTO() ?? {
        pages: [],
        candidates: [],
        activePageId: null,
        revision: 0,
      }
    );
  }
  async assertAccess(query: {
    workspaceId: string;
    userId: string;
  }): Promise<void> {
    await assertDashboardAccess(
      this.workspaces,
      this.members,
      query.workspaceId,
      query.userId,
    );
  }
}
