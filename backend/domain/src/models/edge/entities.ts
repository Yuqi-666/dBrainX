// SPDX-License-Identifier: AGPL-3.0-only

import type { EdgeStateData } from "@workspace/interfaces/models/edge/types";
import type { NodeId } from "@workspace/interfaces/models/node/base";
import { EdgeId, EdgeDirection } from "./value-objects";
import type { EdgeSemanticId } from "./value-objects";

/**
 * Properties for creating an Edge entity.
 */
export interface EdgeProps {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  direction: EdgeDirection;
  semanticId: EdgeSemanticId;
  stateData?: EdgeStateData;
  createdAt?: string;
  updatedAt?: string;
  workspaceId?: string;
}

/**
 * Domain entity representing a directed edge in the knowledge graph.
 * Edges connect two nodes with a specific semantic relationship.
 *
 * Business rules:
 * - An edge cannot connect a node to itself (no self-loops)
 * - Edges are immutable - all updates return new instances
 * - A direction change is an explicit assignment, never a toggle
 */
export class Edge {
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly direction: EdgeDirection;
  readonly semanticId: EdgeSemanticId;
  readonly stateData?: EdgeStateData;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workspaceId?: string;

  private constructor(props: EdgeProps) {
    this.id = props.id;
    this.from = props.from;
    this.to = props.to;
    this.direction = props.direction;
    this.semanticId = props.semanticId;
    this.stateData = props.stateData;
    this.createdAt = props.createdAt ?? new Date().toISOString();
    this.updatedAt = props.updatedAt ?? new Date().toISOString();
    this.workspaceId = props.workspaceId;
  }

  /**
   * Creates a new Edge entity.
   * @param props - Edge properties
   * @throws Error if edge would create a self-loop (from === to)
   */
  static create(props: EdgeProps): Edge {
    if (props.from === props.to) {
      throw new Error(
        `Edge cannot create self-loop: from ${props.from} to ${props.to}`,
      );
    }
    return new Edge(props);
  }

  /**
   * Checks if this edge has the same identity as another edge.
   * Identity is determined by the edge ID.
   */
  sameIdentityAs(other: Edge): boolean {
    return this.id.equals(other.id);
  }

  /**
   * Creates a new edge with the given direction.
   *
   * This assigns the direction; it never toggles it. A caller that repeats
   * the current direction gets the same edge back.
   */
  changeDirection(direction: EdgeDirection): Edge {
    if (this.direction.equals(direction)) {
      return this;
    }

    return new Edge({
      ...this,
      direction,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Creates a new edge with updated semantic information.
   */
  updateSemantic(semanticId: EdgeSemanticId): Edge {
    return new Edge({
      ...this,
      semanticId,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Creates a new edge with updated stateData.
   */
  updateStateData(stateData: EdgeStateData): Edge {
    return new Edge({
      ...this,
      stateData,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Checks if this edge connects to a specific node.
   * Returns true if the node is either the source or target.
   */
  connectsNode(nodeId: NodeId): boolean {
    return this.from === nodeId || this.to === nodeId;
  }

  /**
   * Checks if this edge has the same endpoints as another edge.
   * Considers direction for comparison.
   */
  hasSameEndpointsAs(other: Edge): boolean {
    return (
      this.from === other.from &&
      this.to === other.to &&
      this.direction.equals(other.direction)
    );
  }

  /**
   * Checks if this edge connects the same two nodes as another edge (ignoring direction).
   */
  connectsSameNodesAs(other: Edge): boolean {
    return (
      (this.from === other.from && this.to === other.to) ||
      (this.from === other.to && this.to === other.from)
    );
  }

  /**
   * Gets the source node ID.
   */
  getSourceNode(): NodeId {
    return this.from;
  }

  /**
   * Gets the target node ID.
   */
  getTargetNode(): NodeId {
    return this.to;
  }
}
