// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";

import type { IWorkspaceMemberRepository } from "@workspace/domain/repositories";
import type { WorkspaceMemberId, WorkspaceId } from "@workspace/domain/models/workspace/value-objects";
import { WorkspaceMember } from "@workspace/domain/models/workspace/entities";
import { WorkspaceMemberMapper } from "../database/mappers/workspace-member.mapper";
import { getPocketBaseClient } from "../database/pocketbase-client";

const COLLECTION_NAME = "workspace_members";

export class PocketBaseWorkspaceMemberRepository implements IWorkspaceMemberRepository {
  private get collection() {
    return getPocketBaseClient().collection<RecordModel>(COLLECTION_NAME);
  }

  async findById(id: WorkspaceMemberId): Promise<WorkspaceMember | null> {
    try {
      const record = await this.collection.getOne(id.value);
      return WorkspaceMemberMapper.toDomain(record);
    } catch (error) {
      const pb = getPocketBaseClient();
      if (pb.isClientResponseError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async save(member: WorkspaceMember): Promise<WorkspaceMember> {
    if (!member.id) {
      throw new Error("Domain 校验失败：实体必须包含 id");
    }

    const isTemporaryId = member.id.value.startsWith("tmp_");
    const data = WorkspaceMemberMapper.toRecord(member);
    delete data.id;

    let record;
    if (isTemporaryId) {
      record = await this.collection.create(data, { requestKey: member.id.value });
    } else {
      record = await this.collection.update(member.id.value, data, { requestKey: member.id.value });
    }

    return WorkspaceMemberMapper.toDomain(record);
  }

  async delete(id: WorkspaceMemberId): Promise<void> {
    await this.collection.delete(id.value);
  }

  async findByWorkspaceId(workspaceId: WorkspaceId): Promise<WorkspaceMember[]> {
    const records = await this.collection.getFullList({
      filter: `workspaceId = "${workspaceId.value}"`,
    });
    return records.map(WorkspaceMemberMapper.toDomain);
  }

  async findByUserId(userId: string): Promise<WorkspaceMember[]> {
    const records = await this.collection.getFullList({
      filter: `userId = "${userId}"`,
    });
    return records.map(WorkspaceMemberMapper.toDomain);
  }

  async findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: string,
  ): Promise<WorkspaceMember | null> {
    try {
      const record = await this.collection.getFirstListItem(
        `workspaceId = "${workspaceId.value}" && userId = "${userId}"`,
      );
      return WorkspaceMemberMapper.toDomain(record);
    } catch (error) {
      const pb = getPocketBaseClient();
      if (pb.isClientResponseError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }
}
