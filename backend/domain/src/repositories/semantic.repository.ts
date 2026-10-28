// SPDX-License-Identifier: AGPL-3.0-only

import type {
  NodeSemantic,
  EdgeSemantic,
  NodeTag,
} from "../models/semantic/entities";
import type { SemanticId, TagId } from "../models/semantic/value-objects";
import type { EdgeType } from "../models/edge/value-objects";

// ============================================================
// Semantic Repositories
// ============================================================

/**
 * Query object for filtering node semantics.
 */
export interface NodeSemanticQuery {
  workspaceId?: string;
}

/**
 * Query object for filtering edge semantics.
 */
export interface EdgeSemanticQuery {
  workspaceId?: string;
}

/**
 * Query object for filtering node tags.
 */
export interface NodeTagQuery {
  workspaceId?: string;
}

/**
 * Repository port for NodeSemantic entities.
 */
export interface INodeSemanticRepository {
  findById(id: SemanticId): Promise<NodeSemantic | null>;

  save(semantic: NodeSemantic): Promise<NodeSemantic>;

  delete(id: SemanticId): Promise<void>;

  findAll(query?: NodeSemanticQuery): Promise<NodeSemantic[]>;

  /**
   * Find semantic by exact name match.
   */
  findByName(name: string): Promise<NodeSemantic | null>;

  /**
   * Find semantics that match a color.
   */
  findByColor(color: string): Promise<NodeSemantic[]>;
}

/**
 * Repository port for EdgeSemantic entities.
 */
export interface IEdgeSemanticRepository {
  findById(id: SemanticId): Promise<EdgeSemantic | null>;

  save(semantic: EdgeSemantic): Promise<EdgeSemantic>;

  delete(id: SemanticId): Promise<void>;

  findAll(query?: EdgeSemanticQuery): Promise<EdgeSemantic[]>;

  /**
   * Find semantic by exact name match.
   */
  findByName(name: string): Promise<EdgeSemantic | null>;

  /**
   * Find all semantics of a specific category.
   */
  findByCategory(category: EdgeType["value"]): Promise<EdgeSemantic[]>;
}

/**
 * Repository port for NodeTag entities.
 */
export interface INodeTagRepository {
  findById(id: TagId): Promise<NodeTag | null>;

  save(tag: NodeTag): Promise<NodeTag>;

  delete(id: TagId): Promise<void>;

  findAll(query?: NodeTagQuery): Promise<NodeTag[]>;

  /**
   * Find tag by exact name match.
   */
  findByName(name: string): Promise<NodeTag | null>;

  /**
   * Find multiple tags by their IDs.
   */
  findByIds(ids: TagId[]): Promise<NodeTag[]>;
}
