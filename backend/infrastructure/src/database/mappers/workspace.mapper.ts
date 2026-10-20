// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import type { NodeIcon } from "@workspace/interfaces";
import { Workspace } from "@workspace/domain/models/workspace/entities";
import { WorkspaceId } from "@workspace/domain/models/workspace/value-objects";

export class WorkspaceMapper {
  static toDomain(record: RecordModel): Workspace {
    return Workspace.create({
      id: record.id,
      name: record.name as string,
      ownerId: record.ownerId as string,
      icon: (record.icon as NodeIcon | null | undefined) ?? undefined,
      isDefault: record.isDefault as boolean,
      createdAt: record.created as string | undefined,
      updatedAt: record.updated as string | undefined,
    });
  }

  static toRecord(workspace: Workspace): Partial<RecordModel> {
    return {
      id: workspace.id.value,
      name: workspace.name,
      ownerId: workspace.ownerId,
      // Same clear sentinel as the node mapper: a missing key on a partial
      // PocketBase update keeps the old icon, so "no icon" must be `null`.
      icon: workspace.icon ?? null,
      isDefault: workspace.isDefault,
    };
  }
}
