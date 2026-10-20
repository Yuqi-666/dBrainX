// SPDX-License-Identifier: AGPL-3.0-only

import type { INodeSemanticRepository, NodeSemanticQuery } from "@workspace/domain/repositories";
import type { NodeSemantic } from "@workspace/domain/models";
import type { SemanticId } from "@workspace/domain/models/semantic/value-objects";

export class NodeSemanticDao implements INodeSemanticRepository {
  constructor(private repository: INodeSemanticRepository) {}

  async findById(id: SemanticId): Promise<NodeSemantic | null> {
    return this.repository.findById(id);
  }

  async save(semantic: NodeSemantic): Promise<NodeSemantic> {
    return this.repository.save(semantic);
  }

  async delete(id: SemanticId): Promise<void> {
    return this.repository.delete(id);
  }

  async findAll(query?: NodeSemanticQuery): Promise<NodeSemantic[]> {
    return this.repository.findAll(query);
  }

  async findByName(name: string): Promise<NodeSemantic | null> {
    return this.repository.findByName(name);
  }

  async findByColor(color: string): Promise<NodeSemantic[]> {
    return this.repository.findByColor(color);
  }

  // DAO-specific convenience methods:
  async exists(id: SemanticId): Promise<boolean> {
    const result = await this.repository.findById(id);
    return result !== null;
  }
}
