// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IEdgeRepository,
  EdgeQuery,
} from "@workspace/domain/repositories";
import { Edge } from "@workspace/domain/models/edge/entities";
import type { EdgeId } from "@workspace/domain/models/edge/value-objects";
import type { NodeId } from "@workspace/domain/models/node/value-objects";
import { EdgeMapper, type EdgeRecord } from "../database/mappers/edge.mapper";
import { getPocketBaseClient } from "../database/pocketbase-client";

const COLLECTION_NAME = "edges";

export class PocketBaseEdgeRepository implements IEdgeRepository {
  private get collection() {
    return getPocketBaseClient().collection<EdgeRecord>(COLLECTION_NAME);
  }

  async findById(id: EdgeId): Promise<Edge | null> {
    try {
      const record = await this.collection.getOne(id.getValue());
      return EdgeMapper.toDomain(record);
    } catch {
      return null;
    }
  }

  async save(edge: Edge): Promise<Edge> {
    if (!edge.id) {
      throw new Error("Domain 校验失败：实体必须包含 id");
    }

    const isTemporaryId = edge.id.getValue().startsWith("tmp_");
    const data = EdgeMapper.toRecord(edge);
    delete data.id;

    let record;
    if (isTemporaryId) {
      record = await this.collection.create(data, { requestKey: edge.id.getValue() });
    } else {
      record = await this.collection.update(edge.id.getValue(), data, { requestKey: edge.id.getValue() });
    }

    return EdgeMapper.toDomain(record);
  }

  async delete(id: EdgeId): Promise<void> {
    await this.collection.delete(id.getValue());
  }

  async findAll(query?: EdgeQuery): Promise<Edge[]> {
    const filter = this.buildFilter(query);

    const records = await this.collection.getFullList({
      filter: filter || undefined,
      sort: "-id",
    });

    return records.map((record) => EdgeMapper.toDomain(record));
  }

  async findByIds(ids: EdgeId[]): Promise<Edge[]> {
    if (ids.length === 0) {
      return [];
    }

    const filter = ids.map((id) => `id = "${id.getValue()}"`).join(" || ");
    const records = await this.collection.getFullList({
      filter,
    });

    const recordMap = new Map(
      records.map((record) => [record.id, record]),
    );

    return ids
      .map((id) => recordMap.get(id.getValue()))
      .filter((record): record is EdgeRecord => record !== undefined)
      .map((record) => EdgeMapper.toDomain(record));
  }

  async findByNodeId(nodeId: NodeId): Promise<Edge[]> {
    const filter = `from = "${nodeId}" || to = "${nodeId}"`;
    const records = await this.collection.getFullList({ filter });
    return records.map((record) => EdgeMapper.toDomain(record));
  }

  async findByEndpoints(from: NodeId, to: NodeId): Promise<Edge[]> {
    const filter = `from = "${from}" && to = "${to}"`;
    const records = await this.collection.getFullList({ filter });
    return records.map((record) => EdgeMapper.toDomain(record));
  }

  async count(query?: EdgeQuery): Promise<number> {
    const filter = this.buildFilter(query);
    const records = await this.collection.getFullList({
      filter: filter || undefined,
    });
    return records.length;
  }

  async saveMany(edges: Edge[]): Promise<Edge[]> {
    if (edges.length === 0) {
      return [];
    }

    const records = edges.map((edge) => {
      const data = EdgeMapper.toRecord(edge);
      const { id, ...createData } = data;
      return createData;
    });

    const result = await this.collection.create(records);
    return result.map((record: EdgeRecord) => EdgeMapper.toDomain(record));
  }

  async deleteMany(ids: EdgeId[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await Promise.all(
      ids.map((id) => this.collection.delete(id.getValue())),
    );
  }

  private buildFilter(query?: EdgeQuery): string | undefined {
    if (!query) {
      return undefined;
    }

    const conditions: string[] = [];

    if (query.from) {
      conditions.push(`from = "${query.from}"`);
    }

    if (query.to) {
      conditions.push(`to = "${query.to}"`);
    }

    if (query.semanticId) {
      conditions.push(`semanticId = "${query.semanticId}"`);
    }

    if (query.direction) {
      conditions.push(`direction = "${query.direction.getValue()}"`);
    }

    if (query.workspaceId) {
      conditions.push(`workspaceId = "${query.workspaceId}"`);
    }

    if (conditions.length === 0) {
      return undefined;
    }

    return conditions.join(" && ");
  }
}
