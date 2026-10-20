// SPDX-License-Identifier: AGPL-3.0-only

import type { IDomainEvent } from "../../event-bus";

export interface EdgeCreatedData {
  id: string;
}

export interface EdgeDeletedData {
  id: string;
}

export type EdgeCreated = IDomainEvent<EdgeCreatedData> & {
  eventType: "EdgeCreated";
};

export type EdgeDeleted = IDomainEvent<EdgeDeletedData> & {
  eventType: "EdgeDeleted";
};

export interface EdgeUpdatedData {
  id: string;
}

export type EdgeUpdated = IDomainEvent<EdgeUpdatedData> & {
  eventType: "EdgeUpdated";
};
