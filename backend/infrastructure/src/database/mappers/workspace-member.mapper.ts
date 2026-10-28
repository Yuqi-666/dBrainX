// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import type { WorkspaceRole } from "@workspace/domain/models/workspace/entities";
import { WorkspaceMember } from "@workspace/domain/models/workspace/entities";
import { WorkspaceMemberId, WorkspaceId } from "@workspace/domain/models/workspace/value-objects";

export class WorkspaceMemberMapper {
  static toDomain(record: RecordModel): WorkspaceMember {
    return WorkspaceMember.create({
      id: record.id,
      workspaceId: record.workspaceId as string,
      userId: record.userId as string,
      role: record.role as WorkspaceRole,
      createdAt: record.created as string | undefined,
    });
  }

  static toRecord(member: WorkspaceMember): Partial<RecordModel> {
    return {
      id: member.id.value,
      workspaceId: member.workspaceId.value,
      userId: member.userId,
      role: member.role,
    };
  }
}
