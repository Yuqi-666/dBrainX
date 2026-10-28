// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";

import type {
  IViewRepository,
  ViewQuery,
} from "@workspace/domain/repositories";
import type { NodeId } from "@workspace/domain/models/node/value-objects";
import type { ViewId } from "@workspace/domain/models/view/value-objects";
import { View } from "@workspace/domain/models/view/entities";
import { ViewMapper } from "../database/mappers/view.mapper";
import { getPocketBaseClient } from "../database/pocketbase-client";

const COLLECTION_NAME = "views";

export class PocketBaseViewRepository implements IViewRepository {
  private get collection() {
    return getPocketBaseClient().collection<RecordModel>(COLLECTION_NAME);
  }

  async findById(id: ViewId): Promise<View | null> {
    try {
      const record = await this.collection.getOne(id.value);
      return ViewMapper.toDomain(record);
    } catch (error) {
      const pb = getPocketBaseClient();
      if (pb.isClientResponseError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async save(view: View): Promise<View> {
    if (!view.id) {
      throw new Error("Domain 校验失败：实体必须包含 id");
    }

    const isTemporaryId = view.id.value.startsWith("tmp_");
    const data = ViewMapper.toRecord(view);
    delete data.id;

    let record;
    if (isTemporaryId) {
      record = await this.collection.create(data, { requestKey: view.id.value });
    } else {
      record = await this.collection.update(view.id.value, data, { requestKey: view.id.value });
    }

    return ViewMapper.toDomain(record);
  }

  async delete(id: ViewId): Promise<void> {
    await this.collection.delete(id.value);
  }

  async findAll(query?: ViewQuery): Promise<View[]> {
    const filter = this.buildFilter(query);

    const records = await this.collection.getFullList({
      filter: filter || undefined,
    });

    return records.map(ViewMapper.toDomain);
  }

  async findByNodeId(nodeId: NodeId): Promise<View[]> {
    const filter = `filterConfig~"${nodeId.value}"`;

    const records = await this.collection.getFullList({
      filter,
      sort: "-id",
    });

    return records.map(ViewMapper.toDomain);
  }

  async findPinned(): Promise<View[]> {
    const records = await this.collection.getFullList({
      filter: "isPinned = true",
      sort: "-id",
    });

    return records.map(ViewMapper.toDomain);
  }

  async count(query?: ViewQuery): Promise<number> {
    const filter = this.buildFilter(query);

    const records = await this.collection.getFullList({
      filter: filter || undefined,
    });

    return records.length;
  }

  async saveMany(views: View[]): Promise<View[]> {
    if (views.length === 0) {
      return [];
    }

    const results: View[] = [];
    for (const view of views) {
      const saved = await this.save(view);
      results.push(saved);
    }

    return results;
  }

  async deleteMany(ids: ViewId[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await Promise.all(ids.map((id) => this.collection.delete(id.value)));
  }

  private buildFilter(query?: ViewQuery): string | undefined {
    const filters: string[] = [];

    if (query?.isPinned !== undefined) {
      filters.push(`isPinned = ${query.isPinned}`);
    }

    if (query?.viewType !== undefined) {
      filters.push(`viewType = "${query.viewType}"`);
    }

    if (query?.workspaceId) {
      filters.push(`workspaceId = "${query.workspaceId}"`);
    }

    if (filters.length === 0) {
      return undefined;
    }

    return filters.join(" && ");
  }
}
