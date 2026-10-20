// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import { EdgeSemantic } from "@workspace/domain/models/semantic/entities";
import type { SemanticId } from "@workspace/domain/models/semantic/value-objects";
import type { IEdgeSemanticRepository, EdgeSemanticQuery } from "@workspace/domain/repositories";
import { EdgeType } from "@workspace/domain/models/edge/value-objects";
import { EdgeSemanticMapper } from "../database/mappers/edge-semantic.mapper";
import { getPocketBaseClient } from "../database/pocketbase-client";

const COLLECTION_NAME = "edge_semantics";

export class PocketBaseEdgeSemanticRepository implements IEdgeSemanticRepository {
  private get collection() {
    return getPocketBaseClient().collection<RecordModel>(COLLECTION_NAME);
  }

  private get mapper(): EdgeSemanticMapper {
    return new EdgeSemanticMapper();
  }

  async findById(id: SemanticId): Promise<EdgeSemantic | null> {
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

  async save(semantic: EdgeSemantic): Promise<EdgeSemantic> {
    if (!semantic.id) {
      throw new Error("Domain 校验失败：实体必须包含 id");
    }

    const isTemporaryId = semantic.id.getValue().startsWith("tmp_");
    const data = this.mapper.toRecord(semantic);
    delete data.id;

    let record;
    if (isTemporaryId) {
      record = await this.collection.create(data, { requestKey: semantic.id.getValue() });
    } else {
      record = await this.collection.update(semantic.id.getValue(), data, { requestKey: semantic.id.getValue() });
    }

    return this.mapper.toDomain(record);
  }

  async delete(id: SemanticId): Promise<void> {
    await this.collection.delete(id.getValue());
  }

  async findAll(query?: EdgeSemanticQuery): Promise<EdgeSemantic[]> {
    const filter = query?.workspaceId
      ? `workspaceId = "${query.workspaceId}"`
      : undefined;
    const records = await this.collection.getFullList({ filter });
    return records.map((record) => this.mapper.toDomain(record));
  }

  async findByName(name: string): Promise<EdgeSemantic | null> {
    try {
      const record = await this.collection.getFirstListItem(
        `name="${name}"`
      );
      return this.mapper.toDomain(record);
    } catch (error) {
      const pb = getPocketBaseClient();
      if (pb.isClientResponseError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async findByCategory(category: EdgeType["value"]): Promise<EdgeSemantic[]> {
    const records = await this.collection.getFullList({
      filter: `category="${category}"`,
    });
    return records.map((record) => this.mapper.toDomain(record));
  }
}