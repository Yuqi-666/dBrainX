// SPDX-License-Identifier: AGPL-3.0-only

import type { IEdgeRepository } from "@workspace/domain";
import type { IEventBus } from "@workspace/domain";
import type { EdgeCreated, EdgeDeleted, EdgeUpdated } from "@workspace/domain";
import type { CreateEdgeCommand, UpdateEdgeCommand, DeleteEdgeCommand } from "./command";
import type { EdgeDTO } from "../../dto/edge.dto";
import { Edge } from "@workspace/domain/models/edge/entities";
import {
  EdgeId,
  EdgeDirection,
} from "@workspace/domain/models/edge/value-objects";

function toEdgeDTO(edge: Edge): EdgeDTO {
  return {
    id: edge.id.getValue(),
    workspaceId: edge.workspaceId,
    from: edge.from.toString(),
    to: edge.to.toString(),
    direction: edge.direction.getValue(),
    semanticId: edge.semanticId,
    stateData: edge.stateData,
    createdAt: edge.createdAt,
    updatedAt: edge.updatedAt,
  };
}

function parseEdgeDirection(dir: string): EdgeDirection {
  switch (dir) {
    case "forward":
      return EdgeDirection.forward();
    case "reverse":
      return EdgeDirection.reverse();
    case "bidirectional":
      return EdgeDirection.bidirectional();
    case "undirected":
      return EdgeDirection.undirected();
    default:
      throw new Error(`Invalid edge direction: ${dir}`);
  }
}

export class EdgeCommandService {
  constructor(
    private readonly edgeRepository: IEdgeRepository,
    private readonly eventBus: IEventBus,
  ) { }

  async createEdge(cmd: CreateEdgeCommand): Promise<EdgeDTO> {
    try {
      const edge = Edge.create({
        id: EdgeId.create(cmd.id),
        from: cmd.from,
        to: cmd.to,
        direction: parseEdgeDirection(cmd.direction),
        semanticId: cmd.semanticId,
        stateData: cmd.stateData,
        workspaceId: cmd.workspaceId,
      });

      const saved = await this.edgeRepository.save(edge);

      const event: EdgeCreated = {
        eventType: "EdgeCreated",
        aggregateId: saved.id.getValue(),
        metadata: {
        workspaceId: saved.workspaceId,
          occurredAt: new Date().toISOString(),
          eventVersion: 1,
          userId: cmd.userId,
          sourceId: cmd.sourceId,
        },
        data: {
          id: saved.id.getValue(),
        },
      };
      this.eventBus.publish(event);

      return toEdgeDTO(saved);
    } catch (error) {
      if (error instanceof Error && error.message.includes("self-loop")) {
        throw new Error("Cannot create edge: source and target nodes cannot be the same");
      }
      throw error;
    }
  }

  async updateEdge(cmd: UpdateEdgeCommand): Promise<EdgeDTO> {
    const id = EdgeId.create(cmd.id);
    const edge = await this.edgeRepository.findById(id);

    if (!edge) {
      throw new Error(`Edge not found: ${cmd.id}`);
    }

    let updated = edge;

    if (cmd.direction) {
      updated = updated.changeDirection(parseEdgeDirection(cmd.direction));
    }

    if (cmd.stateData !== undefined) {
      updated = updated.updateStateData(cmd.stateData);
    }

    if (cmd.semanticId !== undefined) {
      updated = updated.updateSemantic(cmd.semanticId);
    }

    const saved = await this.edgeRepository.save(updated);

    const event: EdgeUpdated = {
      eventType: "EdgeUpdated",
      aggregateId: saved.id.getValue(),
      metadata: {
        workspaceId: saved.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.getValue(),
      },
    };
    this.eventBus.publish(event);

    return toEdgeDTO(saved);
  }

  async deleteEdge(cmd: DeleteEdgeCommand): Promise<void> {
    const id = EdgeId.create(cmd.id);
    const existing = await this.edgeRepository.findById(id);
    if (!existing) throw new Error("Record not found");
    await this.edgeRepository.delete(id);

    const event: EdgeDeleted = {
      eventType: "EdgeDeleted",
      aggregateId: cmd.id,
      metadata: {
        workspaceId: existing.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: cmd.id,
      },
    };
    this.eventBus.publish(event);
  }
}
