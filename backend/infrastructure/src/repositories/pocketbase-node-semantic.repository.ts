// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";

import type { INodeSemanticRepository, NodeSemanticQuery } from "@workspace/domain/repositories";
import { NodeSemantic } from "@workspace/domain/models/semantic/entities";
import type { SemanticId } from "@workspace/domain/models/semantic/value-objects";
import { NodeSemanticMapper } from "../database/mappers/node-semantic.mapper";
import { PocketBaseClient } from "../database/pocketbase-client";

const COLLECTION_NAME = "node_semantics";

export class PocketBaseNodeSemanticRepository implements INodeSemanticRepository {
  private readonly mapper: NodeSemanticMapper;

  constructor(private pb: PocketBaseClient) {
    this.mapper = new NodeSemanticMapper();
  }

  private collection() {
    return this.pb.collection<NodeSemanticRecord>(COLLECTION_NAME);
  }

  async findById(id: SemanticId): Promise<NodeSemantic | null> {
    try {
      const record = await this.collection().getOne(id.getValue());
      return this.mapper.toDomain(record);
    } catch (error) {
      if (this.pb.isClientResponseError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async save(semantic: NodeSemantic): Promise<NodeSemantic> {
    if (!semantic.id) {
      throw new Error("Domain 校验失败：实体必须包含 id");
    }

    const isTemporaryId = semantic.id.getValue().startsWith("tmp_");
    const data = this.mapper.toRecord(semantic);
    delete data.id;

    let record;
    if (isTemporaryId) {
      record = await this.collection().create(data, { requestKey: semantic.id.getValue() });
    } else {
      record = await this.collection().update(semantic.id.getValue(), data, { requestKey: semantic.id.getValue() });
    }

    return this.mapper.toDomain(record);
  }

  async delete(id: SemanticId): Promise<void> {
    await this.collection().delete(id.getValue());
  }

  async findAll(query?: NodeSemanticQuery): Promise<NodeSemantic[]> {
    const filter = query?.workspaceId
      ? `workspaceId = "${query.workspaceId}"`
      : undefined;
    const records = await this.collection().getFullList({
      filter,
    });
    return records.map((record) => this.mapper.toDomain(record));
  }

  async findByName(name: string): Promise<NodeSemantic | null> {
    try {
      const records = await this.collection().getFullList({
        filter: `name = "${name}"`,
      });
      const firstRecord = records[0];
      if (!firstRecord) {
        return null;
      }
      return this.mapper.toDomain(firstRecord);
    } catch {
      return null;
    }
  }

  async findByColor(color: string): Promise<NodeSemantic[]> {
    const records = await this.collection().getFullList({
      filter: `color = "${color}"`,
    });
    return records.map((record) => this.mapper.toDomain(record));
  }
}

interface NodeSemanticRecord extends RecordModel {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  workspaceId?: string;
}