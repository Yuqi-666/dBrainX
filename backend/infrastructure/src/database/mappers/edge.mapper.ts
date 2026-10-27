// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import type { EdgeStateData } from "@workspace/interfaces/models/edge/types";
import { Edge } from "@workspace/domain/models/edge/entities";
import {
  EdgeId,
  EdgeDirection,
} from "@workspace/domain/models/edge/value-objects";

/**
 * PocketBase `edges` collection record. Flat, homogeneous structure — a
 * single interface covers all edges (unlike the 9-variant `NodeRecord` set).
 */
export interface EdgeRecord extends RecordModel {
  id: string;
  from: string;
  to: string;
  direction: string;
  semanticId: string;
  stateData?: EdgeStateData;
  created: string;
  updated: string;
  workspaceId?: string;
}

/**
 * Maps between PocketBase RecordModel and domain Edge entity.
 */
export class EdgeMapper {
  /**
   * Converts a PocketBase record to a domain Edge entity.
   */
  static toDomain(record: EdgeRecord): Edge {
    return Edge.create({
      id: EdgeId.create(record.id),
      from: record.from,
      to: record.to,
      direction: EdgeMapper.mapDirectionToDomain(record.direction),
      semanticId: record.semanticId,
      stateData: record.stateData ?? undefined,
      createdAt: record.created,
      updatedAt: record.updated,
      workspaceId: record.workspaceId as string | undefined,
    });
  }

  /**
   * Converts a domain Edge entity to a Partial PocketBase RecordModel.
   */
  static toRecord(edge: Edge): Partial<EdgeRecord> {
    return {
      id: edge.id.getValue(),
      from: edge.from,
      to: edge.to,
      direction: edge.direction.getValue(),
      semanticId: edge.semanticId,
      stateData: edge.stateData,
      workspaceId: edge.workspaceId,
    };
  }

  private static mapDirectionToDomain(
    direction: string,
  ): EdgeDirection {
    switch (direction) {
      case "forward":
        return EdgeDirection.forward();
      case "reverse":
        return EdgeDirection.reverse();
      case "bidirectional":
        return EdgeDirection.bidirectional();
      case "undirected":
        return EdgeDirection.undirected();
      // Spelling written before the direction rename migration. A database
      // that has not run the change script must still read as undirected,
      // not fall through to the forward default.
      case "unidirectional":
        return EdgeDirection.undirected();
      default:
        return EdgeDirection.forward();
    }
  }
}
