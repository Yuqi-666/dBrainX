// SPDX-License-Identifier: AGPL-3.0-only

import type { IDomainEvent } from "../../event-bus";

export interface NodeCreatedData {
  id: string;
}

export interface NodeDeletedData {
  id: string;
}

export type NodeCreated = IDomainEvent<NodeCreatedData> & {
  eventType: "NodeCreated";
};

export type NodeDeleted = IDomainEvent<NodeDeletedData> & {
  eventType: "NodeDeleted";
};

export interface NodeUpdatedData {
  id: string;
}

export type NodeUpdated = IDomainEvent<NodeUpdatedData> & {
  eventType: "NodeUpdated";
};
