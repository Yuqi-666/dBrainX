// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import { NodeSemantic } from "@workspace/domain/models/semantic/entities";
import { SemanticId } from "@workspace/domain/models/semantic/value-objects";

export class NodeSemanticMapper {
  toDomain(record: RecordModel): NodeSemantic {
    return NodeSemantic.create({
      id: SemanticId.create(record.id),
      name: record.name as string,
      description: record.description as string | undefined,
      color: record.color as string | undefined,
      icon: record.icon as string | undefined,
      workspaceId: record.workspaceId as string | undefined,
    });
  }

  toRecord(entity: NodeSemantic): Partial<RecordModel> {
    return {
      id: entity.id.getValue(),
      name: entity.name,
      description: entity.description,
      color: entity.color,
      icon: entity.icon,
      workspaceId: entity.workspaceId,
    };
  }
}