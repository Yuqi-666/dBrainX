// SPDX-License-Identifier: AGPL-3.0-only

import { View } from "../models/view/entities";
import type { ViewId, ViewType } from "../models/view/value-objects";
import type { NodeId } from "../models/node/value-objects";

// ============================================================
// Query Objects (Plain objects for flexible querying)
// ============================================================

/**
 * View query object for flexible filtering.
 */
export interface ViewQuery {
  isPinned?: boolean;
  viewType?: ViewType["value"];
  workspaceId?: string;
}

// ============================================================
// IViewRepository - View Aggregate
// ============================================================

/**
 * Repository port for View entities.
 */
export interface IViewRepository {
  // ----- Single Entity Operations -----

  findById(id: ViewId): Promise<View | null>;

  save(view: View): Promise<View>;

  delete(id: ViewId): Promise<void>;

  // ----- Collection Operations -----

  /**
   * Find all views matching query (no pagination).
   */
  findAll(query?: ViewQuery): Promise<View[]>;

  /**
   * Find all views that contain a specific node in their filter config.
   */
  findByNodeId(nodeId: NodeId): Promise<View[]>;

  /**
   * Find all pinned views.
   */
  findPinned(): Promise<View[]>;

  count(query?: ViewQuery): Promise<number>;

  // ----- Batch Operations -----

  saveMany(views: View[]): Promise<View[]>;

  deleteMany(ids: ViewId[]): Promise<void>;
}
