// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import { NodeTag } from "@workspace/domain/models/semantic/entities";
import type { TagId } from "@workspace/domain/models/semantic/value-objects";
import type { INodeTagRepository, NodeTagQuery } from "@workspace/domain/repositories";
import { NodeTagMapper } from "../database/mappers/node-tag.mapper";
import { getPocketBaseClient } from "../database/pocketbase-client";

const COLLECTION_NAME = "node_tags";

export class PocketBaseNodeTagRepository implements INodeTagRepository {
  private get collection() {
    return getPocketBaseClient().collection<RecordModel>(COLLECTION_NAME);
  }

  private get mapper(): NodeTagMapper {
    return new NodeTagMapper();
  }

  async findById(id: TagId): Promise<NodeTag | null> {
    try {
      const record = await this.collection.getOne(id.getValue());
      return this.mapper.toDomain(record);
    } catch (error) {
      const pb = getPocketBaseClient();
      if (pb.isClientResponseError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async save(tag: NodeTag): Promise<NodeTag> {
    if (!tag.id) {
      throw new Error("Domain 校验失败：实体必须包含 id");
    }

    const isTemporaryId = tag.id.getValue().startsWith("tmp_");
    const data = this.mapper.toRecord(tag);
    delete data.id;

    let record;
    if (isTemporaryId) {
      record = await this.collection.create(data, { requestKey: tag.id.getValue() });
    } else {
      record = await this.collection.update(tag.id.getValue(), data, { requestKey: tag.id.getValue() });
    }

    return this.mapper.toDomain(record);
  }

  async delete(id: TagId): Promise<void> {
    await this.collection.delete(id.getValue());
  }

  async findAll(query?: NodeTagQuery): Promise<NodeTag[]> {
    const filter = query?.workspaceId
      ? `workspaceId = "${query.workspaceId}"`
      : undefined;
    const records = await this.collection.getFullList({ filter });
    return records.map((record) => this.mapper.toDomain(record));
  }

  async findByName(name: string): Promise<NodeTag | null> {
    try {
      const record = await this.collection.getFirstListItem(`name="${name}"`);
      return this.mapper.toDomain(record);
    } catch (error) {
      const pb = getPocketBaseClient();
      if (pb.isClientResponseError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async findByIds(ids: TagId[]): Promise<NodeTag[]> {
    if (ids.length === 0) {
      return [];
    }

    const idValues = ids.map((id) => id.getValue());
    const filter = `id ?= "${idValues.join('" || id ?= "')}"`;

    const records = await this.collection.getFullList({
      filter,
    });

    const tagMap = new Map(
      records.map((record) => [record.id, this.mapper.toDomain(record)]),
    );

    return ids
      .map((id) => tagMap.get(id.getValue()))
      .filter((tag): tag is NodeTag => tag !== undefined);
  }
}