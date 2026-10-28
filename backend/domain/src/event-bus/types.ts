// SPDX-License-Identifier: AGPL-3.0-only

export interface EventMetadata {
  occurredAt: string;
  eventVersion: 1;
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}
