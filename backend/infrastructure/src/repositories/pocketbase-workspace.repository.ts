// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";

import type { IWorkspaceRepository } from "@workspace/domain/repositories";
import type { WorkspaceId } from "@workspace/domain/models/workspace/value-objects";
import { Workspace } from "@workspace/domain/models/workspace/entities";
import { WorkspaceMapper } from "../database/mappers/workspace.mapper";
import { getPocketBaseClient } from "../database/pocketbase-client";

const COLLECTION_NAME = "workspaces";

export class PocketBaseWorkspaceRepository implements IWorkspaceRepository {
  private get collection() {
    return getPocketBaseClient().collection<RecordModel>(COLLECTION_NAME);
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    try {
      const record = await this.collection.getOne(id.value);
      return WorkspaceMapper.toDomain(record);
    } catch (error) {
      const pb = getPocketBaseClient();
      if (pb.isClientResponseError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async save(workspace: Workspace): Promise<Workspace> {
    if (!workspace.id) {
      throw new Error("Domain 校验失败：实体必须包含 id");
    }

    const isTemporaryId = workspace.id.value.startsWith("tmp_");
    const data = WorkspaceMapper.toRecord(workspace);
    delete data.id;

    let record;
    if (isTemporaryId) {
      record = await this.collection.create(data, { requestKey: workspace.id.value });
    } else {
      record = await this.collection.update(workspace.id.value, data, { requestKey: workspace.id.value });
    }

    return WorkspaceMapper.toDomain(record);
  }

  async delete(id: WorkspaceId): Promise<void> {
    await this.collection.delete(id.value);
  }

  async findAll(): Promise<Workspace[]> {
    const records = await this.collection.getFullList();
    return records.map(WorkspaceMapper.toDomain);
  }

  async findByOwnerId(ownerId: string): Promise<Workspace[]> {
    const records = await this.collection.getFullList({
      filter: `ownerId = "${ownerId}"`,
    });
    return records.map(WorkspaceMapper.toDomain);
  }
}
