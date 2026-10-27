// SPDX-License-Identifier: AGPL-3.0-only

import type { IDomainEvent } from "../../event-bus";

export interface ViewCreatedData {
  id: string;
}

export interface ViewDeletedData {
  id: string;
}

export type ViewCreated = IDomainEvent<ViewCreatedData> & {
  eventType: "ViewCreated";
};
export type ViewDeleted = IDomainEvent<ViewDeletedData> & {
  eventType: "ViewDeleted";
};

export interface ViewUpdatedData {
  id: string;
}

export type ViewUpdated = IDomainEvent<ViewUpdatedData> & {
  eventType: "ViewUpdated";
};
