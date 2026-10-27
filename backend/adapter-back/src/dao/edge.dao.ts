// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IEdgeRepository,
  EdgeQuery,
} from "@workspace/domain/repositories";
import type { Edge, EdgeSemanticId } from "@workspace/domain/models";
import { EdgeId } from "@workspace/domain/models/edge/value-objects";
import { NodeId } from "@workspace/domain/models/node/value-objects";

export class EdgeDao implements IEdgeRepository {
  constructor(private repository: IEdgeRepository) {}

  async findBySemanticId(semanticId: EdgeSemanticId): Promise<Edge[]> {
    return this.repository.findAll({ semanticId });
  }

  async findByNodeId(nodeId: NodeId): Promise<Edge[]> {
    return this.repository.findByNodeId(nodeId);
  }

  async findByEndpoints(from: NodeId, to: NodeId): Promise<Edge[]> {
    return this.repository.findByEndpoints(from, to);
  }

  async findBidirectionalEdges(): Promise<Edge[]> {
    return this.repository.findAll({}).then(edges =>
      edges.filter((edge) => edge.direction.isBidirectional())
    );
  }

  async findPaginated(
    query?: EdgeQuery,
  ): Promise<{ items: Edge[]; total: number }> {
    const items = await this.repository.findAll(query);
    return {
      items,
      total: items.length,
    };
  }

  async batchSave(edges: Edge[]): Promise<{ saved: Edge[]; failed: number }> {
    const saved: Edge[] = [];
    let failed = 0;

    for (const edge of edges) {
      try {
        const result = await this.repository.save(edge);
        saved.push(result);
      } catch {
        failed++;
      }
    }

    return { saved, failed };
  }

  async batchDelete(edgeIds: EdgeId[]): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    for (const id of edgeIds) {
      try {
        await this.repository.delete(id);
        deleted++;
      } catch {
        failed++;
      }
    }

    return { deleted, failed };
  }

  async findById(id: EdgeId): Promise<Edge | null> {
    return this.repository.findById(id);
  }

  async save(edge: Edge): Promise<Edge> {
    return this.repository.save(edge);
  }

  async delete(id: EdgeId): Promise<void> {
    return this.repository.delete(id);
  }

  async findAll(query?: EdgeQuery): Promise<Edge[]> {
    return this.repository.findAll(query);
  }

  async findByIds(ids: EdgeId[]): Promise<Edge[]> {
    return this.repository.findByIds(ids);
  }

  async count(query?: EdgeQuery): Promise<number> {
    return this.repository.count(query);
  }

  async saveMany(edges: Edge[]): Promise<Edge[]> {
    return this.repository.saveMany(edges);
  }

  async deleteMany(ids: EdgeId[]): Promise<void> {
    return this.repository.deleteMany(ids);
  }

  async exists(id: EdgeId): Promise<boolean> {
    const edge = await this.repository.findById(id);
    return edge !== null;
  }

  async getConnectedNodes(nodeId: NodeId): Promise<NodeId[]> {
    const edges = await this.repository.findByNodeId(nodeId);
    const connected = new Set<string>();

    for (const edge of edges) {
      if (edge.from !== nodeId.value) {
        connected.add(edge.from);
      }
      if (edge.to !== nodeId.value) {
        connected.add(edge.to);
      }
    }

    return Array.from(connected).map((id) => new NodeId(id));
  }
}