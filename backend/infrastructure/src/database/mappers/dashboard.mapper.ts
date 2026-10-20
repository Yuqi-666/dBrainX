// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import { Dashboard } from "@workspace/domain";
import type { DashboardWorkspace } from "@workspace/interfaces";

export class DashboardMapper {
  static toDomain(record: RecordModel): Dashboard {
    const state = record.config as Omit<DashboardWorkspace, "revision">;
    return Dashboard.create(
      record.workspaceId as string,
      record.ownerId as string,
      { ...state, revision: record.revision as number },
      record.id,
    );
  }
  static toRecord(dashboard: Dashboard) {
    const { revision, ...config } = dashboard.toDTO();
    return {
      workspaceId: dashboard.workspaceId,
      ownerId: dashboard.ownerId,
      revision,
      config,
    };
  }
}
