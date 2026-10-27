// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import { DashboardConflictError } from "@workspace/domain";
import type { IDashboardRepository, Dashboard } from "@workspace/domain";
import type { PocketBaseClient } from "../database/pocketbase-client";
import { DashboardMapper } from "../database/mappers/dashboard.mapper";

/** Request-bound token: never mutates the shared client's authStore. */
export class PocketBaseDashboardRepository implements IDashboardRepository {
  constructor(
    private readonly pb: PocketBaseClient,
    private readonly token: string,
  ) {}
  async findLatest(
    workspaceId: string,
    ownerId: string,
  ): Promise<Dashboard | null> {
    const result = await this.pb
      .collection<RecordModel>("dashboard_configs")
      .getList(1, 1, {
        filter: this.pb.client.filter(
          "workspaceId = {:workspaceId} && ownerId = {:ownerId}",
          { workspaceId, ownerId },
        ),
        sort: "-revision",
        headers: { Authorization: this.token },
      });
    return result.items[0] ? DashboardMapper.toDomain(result.items[0]) : null;
  }
  async save(dashboard: Dashboard): Promise<Dashboard> {
    try {
      const record = await this.pb
        .collection<RecordModel>("dashboard_configs")
        .create(DashboardMapper.toRecord(dashboard), {
          headers: { Authorization: this.token },
        });
      return DashboardMapper.toDomain(record);
    } catch (error) {
      if (
        this.pb.isClientResponseError(error) &&
        error.status === 400 &&
        Object.values(error.response?.data ?? {}).some(
          (value) =>
            (value as { code?: string }).code === "validation_not_unique",
        )
      )
        throw new DashboardConflictError("Dashboard changed on another device");
      throw error;
    }
  }
}
