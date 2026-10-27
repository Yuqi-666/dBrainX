// SPDX-License-Identifier: AGPL-3.0-only

import type {
  INodeSemanticRepository,
  IEdgeSemanticRepository,
  INodeTagRepository,
} from "@workspace/domain";
import type { IEventBus } from "@workspace/domain";
import type {
  NodeSemanticCreated,
  NodeSemanticUpdated,
  NodeSemanticDeleted,
  EdgeSemanticCreated,
  EdgeSemanticUpdated,
  EdgeSemanticDeleted,
  NodeTagCreated,
  NodeTagUpdated,
  NodeTagDeleted,
} from "@workspace/domain";
import type {
  CreateNodeSemanticCommand,
  UpdateNodeSemanticCommand,
  DeleteNodeSemanticCommand,
  CreateEdgeSemanticCommand,
  UpdateEdgeSemanticCommand,
  DeleteEdgeSemanticCommand,
  CreateNodeTagCommand,
  UpdateNodeTagCommand,
  DeleteNodeTagCommand,
} from "./command";
import type {
  NodeSemanticDTO,
  EdgeSemanticDTO,
  NodeTagDTO,
} from "../../dto/semantic.dto";
import {
  NodeSemantic,
  EdgeSemantic,
  NodeTag,
} from "@workspace/domain";
import { SemanticId, TagId } from "@workspace/domain";
import type { EdgeType } from "@workspace/interfaces/models/edge/types";

function toNodeSemanticDTO(s: NodeSemantic): NodeSemanticDTO {
  return {
    id: s.id.toString(),
    name: s.name,
    description: s.description,
    color: s.color,
    icon: s.icon,
    workspaceId: s.workspaceId,
  };
}

function toEdgeSemanticDTO(s: EdgeSemantic): EdgeSemanticDTO {
  return {
    id: s.id.toString(),
    name: s.name,
    category: s.category,
    description: s.description,
    color: s.color,
    icon: s.icon,
    workspaceId: s.workspaceId,
  };
}

function toNodeTagDTO(t: NodeTag): NodeTagDTO {
  return {
    id: t.id.toString(),
    name: t.name,
    color: t.color,
    workspaceId: t.workspaceId,
  };
}

export class SemanticCommandService {
  constructor(
    private readonly nodeSemanticRepository: INodeSemanticRepository,
    private readonly edgeSemanticRepository: IEdgeSemanticRepository,
    private readonly nodeTagRepository: INodeTagRepository,
    private readonly eventBus: IEventBus,
  ) {}

  async createNodeSemantic(
    cmd: CreateNodeSemanticCommand,
  ): Promise<NodeSemanticDTO> {
    const semantic = NodeSemantic.create({
      id: SemanticId.create(cmd.id),
      name: cmd.name,
      description: cmd.description,
      color: cmd.color,
      icon: cmd.icon,
      workspaceId: cmd.workspaceId,
    });

    const saved = await this.nodeSemanticRepository.save(semantic);

    const event: NodeSemanticCreated = {
      eventType: "NodeSemanticCreated",
      aggregateId: saved.id.toString(),
      metadata: {
        workspaceId: saved.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.toString(),
      },
    };
    this.eventBus.publish(event);

    return toNodeSemanticDTO(saved);
  }

  async updateNodeSemantic(
    cmd: UpdateNodeSemanticCommand,
  ): Promise<NodeSemanticDTO> {
    const id = SemanticId.create(cmd.id);
    const existing = await this.nodeSemanticRepository.findById(id);

    if (!existing) {
      throw new Error(`NodeSemantic with id ${cmd.id} not found`);
    }

    const updated = existing.update({
      name: cmd.name,
      description: cmd.description,
      color: cmd.color,
      icon: cmd.icon,
    });

    const saved = await this.nodeSemanticRepository.save(updated);

    const event: NodeSemanticUpdated = {
      eventType: "NodeSemanticUpdated",
      aggregateId: saved.id.toString(),
      metadata: {
        workspaceId: saved.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.toString(),
      },
    };
    this.eventBus.publish(event);

    return toNodeSemanticDTO(saved);
  }

  async deleteNodeSemantic(cmd: DeleteNodeSemanticCommand): Promise<void> {
    const id = SemanticId.create(cmd.id);
    const existing = await this.nodeSemanticRepository.findById(id);
    if (!existing) throw new Error("Record not found");

    const event: NodeSemanticDeleted = {
      eventType: "NodeSemanticDeleted",
      aggregateId: id.toString(),
      metadata: {
        workspaceId: existing.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: id.toString(),
      },
    };
    this.eventBus.publish(event);

    await this.nodeSemanticRepository.delete(id);
  }

  async createEdgeSemantic(
    cmd: CreateEdgeSemanticCommand,
  ): Promise<EdgeSemanticDTO> {
    const semantic = EdgeSemantic.create({
      id: SemanticId.create(cmd.id),
      name: cmd.name,
      category: cmd.category,
      description: cmd.description,
      color: cmd.color,
      icon: cmd.icon,
      workspaceId: cmd.workspaceId,
    });

    const saved = await this.edgeSemanticRepository.save(semantic);

    const event: EdgeSemanticCreated = {
      eventType: "EdgeSemanticCreated",
      aggregateId: saved.id.toString(),
      metadata: {
        workspaceId: saved.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.toString(),
      },
    };
    this.eventBus.publish(event);

    return toEdgeSemanticDTO(saved);
  }

  async updateEdgeSemantic(
    cmd: UpdateEdgeSemanticCommand,
  ): Promise<EdgeSemanticDTO> {
    const id = SemanticId.create(cmd.id);
    const existing = await this.edgeSemanticRepository.findById(id);

    if (!existing) {
      throw new Error(`EdgeSemantic with id ${cmd.id} not found`);
    }

    const updated = existing.update({
      name: cmd.name,
      category: cmd.category,
      description: cmd.description,
      color: cmd.color,
      icon: cmd.icon,
    });

    const saved = await this.edgeSemanticRepository.save(updated);

    const event: EdgeSemanticUpdated = {
      eventType: "EdgeSemanticUpdated",
      aggregateId: saved.id.toString(),
      metadata: {
        workspaceId: saved.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.toString(),
      },
    };
    this.eventBus.publish(event);

    return toEdgeSemanticDTO(saved);
  }

  async deleteEdgeSemantic(cmd: DeleteEdgeSemanticCommand): Promise<void> {
    const id = SemanticId.create(cmd.id);
    const existing = await this.edgeSemanticRepository.findById(id);
    if (!existing) throw new Error("Record not found");

    const event: EdgeSemanticDeleted = {
      eventType: "EdgeSemanticDeleted",
      aggregateId: id.toString(),
      metadata: {
        workspaceId: existing.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: id.toString(),
      },
    };
    this.eventBus.publish(event);

    await this.edgeSemanticRepository.delete(id);
  }

  async createNodeTag(cmd: CreateNodeTagCommand): Promise<NodeTagDTO> {
    const tag = NodeTag.create({
      id: TagId.create(cmd.id),
      name: cmd.name,
      color: cmd.color,
      workspaceId: cmd.workspaceId,
    });

    const saved = await this.nodeTagRepository.save(tag);

    const event: NodeTagCreated = {
      eventType: "NodeTagCreated",
      aggregateId: saved.id.toString(),
      metadata: {
        workspaceId: saved.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.toString(),
      },
    };
    this.eventBus.publish(event);

    return toNodeTagDTO(saved);
  }

  async updateNodeTag(cmd: UpdateNodeTagCommand): Promise<NodeTagDTO> {
    const id = TagId.create(cmd.id);
    const existing = await this.nodeTagRepository.findById(id);

    if (!existing) {
      throw new Error(`NodeTag with id ${cmd.id} not found`);
    }

    const updated = existing.update({
      name: cmd.name,
      color: cmd.color,
    });

    const saved = await this.nodeTagRepository.save(updated);

    const event: NodeTagUpdated = {
      eventType: "NodeTagUpdated",
      aggregateId: saved.id.toString(),
      metadata: {
        workspaceId: saved.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.toString(),
      },
    };
    this.eventBus.publish(event);

    return toNodeTagDTO(saved);
  }

  async deleteNodeTag(cmd: DeleteNodeTagCommand): Promise<void> {
    const id = TagId.create(cmd.id);
    const existing = await this.nodeTagRepository.findById(id);
    if (!existing) throw new Error("Record not found");

    const event: NodeTagDeleted = {
      eventType: "NodeTagDeleted",
      aggregateId: id.toString(),
      metadata: {
        workspaceId: existing.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: id.toString(),
      },
    };
    this.eventBus.publish(event);

    await this.nodeTagRepository.delete(id);
  }
}