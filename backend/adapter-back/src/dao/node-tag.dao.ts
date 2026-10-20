// SPDX-License-Identifier: AGPL-3.0-only

import type { INodeTagRepository, NodeTagQuery } from "@workspace/domain/repositories";
import type { NodeTag, TagId } from "@workspace/domain/models/semantic";

export class NodeTagDao implements INodeTagRepository {
  constructor(private repository: INodeTagRepository) {}

  async findById(id: TagId): Promise<NodeTag | null> {
    return this.repository.findById(id);
  }

  async save(tag: NodeTag): Promise<NodeTag> {
    return this.repository.save(tag);
  }

  async delete(id: TagId): Promise<void> {
    return this.repository.delete(id);
  }

  async findAll(query?: NodeTagQuery): Promise<NodeTag[]> {
    return this.repository.findAll(query);
  }

  async findByName(name: string): Promise<NodeTag | null> {
    return this.repository.findByName(name);
  }

  async findByIds(ids: TagId[]): Promise<NodeTag[]> {
    return this.repository.findByIds(ids);
  }

  // DAO-specific convenience methods:
  async exists(id: TagId): Promise<boolean> {
    const result = await this.repository.findById(id);
    return result !== null;
  }
}
