// SPDX-License-Identifier: AGPL-3.0-only

import type { IEdgeSemanticRepository, EdgeSemanticQuery } from "@workspace/domain/repositories";
import type { EdgeSemantic, SemanticId } from "@workspace/domain/models";
import type { EdgeType } from "@workspace/domain/models/edge/value-objects";

export class EdgeSemanticDao implements IEdgeSemanticRepository {
  constructor(private repository: IEdgeSemanticRepository) {}

  async findById(id: SemanticId): Promise<EdgeSemantic | null> {
    return this.repository.findById(id);
  }

  async save(semantic: EdgeSemantic): Promise<EdgeSemantic> {
    return this.repository.save(semantic);
  }

  async delete(id: SemanticId): Promise<void> {
    return this.repository.delete(id);
  }

  async findAll(query?: EdgeSemanticQuery): Promise<EdgeSemantic[]> {
    return this.repository.findAll(query);
  }

  async findByName(name: string): Promise<EdgeSemantic | null> {
    return this.repository.findByName(name);
  }

  async findByCategory(category: EdgeType["value"]): Promise<EdgeSemantic[]> {
    return this.repository.findByCategory(category);
  }

  // DAO-specific convenience methods:
  async exists(id: SemanticId): Promise<boolean> {
    const result = await this.repository.findById(id);
    return result !== null;
  }
}
