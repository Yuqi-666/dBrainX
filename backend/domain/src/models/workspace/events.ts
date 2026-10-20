// SPDX-License-Identifier: AGPL-3.0-only

import type { IDomainEvent } from "../../event-bus";

export interface WorkspaceCreatedData {
  id: string;
}

export interface WorkspaceDeletedData {
  id: string;
}

export interface WorkspaceUpdatedData {
  id: string;
}

export type WorkspaceCreated = IDomainEvent<WorkspaceCreatedData> & {
  eventType: "WorkspaceCreated";
};
export type WorkspaceDeleted = IDomainEvent<WorkspaceDeletedData> & {
  eventType: "WorkspaceDeleted";
};
export type WorkspaceUpdated = IDomainEvent<WorkspaceUpdatedData> & {
  eventType: "WorkspaceUpdated";
};

export interface WorkspaceMemberAddedData {
  id: string;
  workspaceId: string;
  userId: string;
}

export interface WorkspaceMemberRemovedData {
  id: string;
  workspaceId: string;
  userId: string;
}

export type WorkspaceMemberAdded = IDomainEvent<WorkspaceMemberAddedData> & {
  eventType: "WorkspaceMemberAdded";
};
export type WorkspaceMemberRemoved =
  IDomainEvent<WorkspaceMemberRemovedData> & {
    eventType: "WorkspaceMemberRemoved";
  };
