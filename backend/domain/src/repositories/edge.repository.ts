// SPDX-License-Identifier: AGPL-3.0-only

import { Edge } from "../models/edge/entities";
import type {
  EdgeId,
  EdgeSemanticId,
  EdgeDirection,
} from "../models/edge/value-objects";
import type { NodeId } from "../models/node/value-objects";

// ============================================================
// Query Objects (Plain objects for flexible querying)
// ============================================================

/**
 * Edge query object for flexible filtering.
 */
export interface EdgeQuery {
  from?: NodeId;
  to?: NodeId;
  semanticId?: EdgeSemanticId;
  direction?: EdgeDirection;
  workspaceId?: string;
}

// ============================================================
// IEdgeRepository - Edge Aggregate
// ============================================================

/**
 * Repository port for Edge entities.
 */
export interface IEdgeRepository {
  // ----- Single Entity Operations -----

  findById(id: EdgeId): Promise<Edge | null>;

  save(edge: Edge): Promise<Edge>;

  delete(id: EdgeId): Promise<void>;

  // ----- Collection Operations -----

  /**
   * Find all edges matching query (no pagination).
   */
  findAll(query?: EdgeQuery): Promise<Edge[]>;

  findByIds(ids: EdgeId[]): Promise<Edge[]>;

  /**
   * Find all edges connected to a specific node (as source or target).
   */
  findByNodeId(nodeId: NodeId): Promise<Edge[]>;

  /**
   * Find edges between two specific nodes.
   */
  findByEndpoints(from: NodeId, to: NodeId): Promise<Edge[]>;

  count(query?: EdgeQuery): Promise<number>;

  // ----- Batch Operations -----

  saveMany(edges: Edge[]): Promise<Edge[]>;

  deleteMany(ids: EdgeId[]): Promise<void>;
}
