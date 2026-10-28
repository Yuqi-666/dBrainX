// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import { NodeTag } from "@workspace/domain/models/semantic/entities";
import { TagId } from "@workspace/domain/models/semantic/value-objects";

export class NodeTagMapper {
  toDomain(record: RecordModel): NodeTag {
    return NodeTag.create({
      id: TagId.create(record.id),
      name: record.name as string,
      color: record.color as string | undefined,
      workspaceId: record.workspaceId as string | undefined,
    });
  }

  toRecord(entity: NodeTag): Partial<RecordModel> {
    return {
      id: entity.id.getValue(),
      name: entity.name,
      color: entity.color,
      workspaceId: entity.workspaceId,
    };
  }
}