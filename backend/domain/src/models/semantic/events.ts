// SPDX-License-Identifier: AGPL-3.0-only

import type { IDomainEvent } from "../../event-bus";

export interface NodeSemanticCreatedData {
  id: string;
}

export interface EdgeSemanticCreatedData {
  id: string;
}

export interface NodeTagCreatedData {
  id: string;
}

export type NodeSemanticCreated = IDomainEvent<NodeSemanticCreatedData> & {
  eventType: "NodeSemanticCreated";
};
export type EdgeSemanticCreated = IDomainEvent<EdgeSemanticCreatedData> & {
  eventType: "EdgeSemanticCreated";
};
export type NodeTagCreated = IDomainEvent<NodeTagCreatedData> & {
  eventType: "NodeTagCreated";
};

export interface NodeSemanticUpdatedData {
  id: string;
}

export interface EdgeSemanticUpdatedData {
  id: string;
}

export interface NodeTagUpdatedData {
  id: string;
}

export interface NodeSemanticDeletedData {
  id: string;
}

export interface EdgeSemanticDeletedData {
  id: string;
}

export interface NodeTagDeletedData {
  id: string;
}

export type NodeSemanticUpdated = IDomainEvent<NodeSemanticUpdatedData> & {
  eventType: "NodeSemanticUpdated";
};

export type EdgeSemanticUpdated = IDomainEvent<EdgeSemanticUpdatedData> & {
  eventType: "EdgeSemanticUpdated";
};

export type NodeSemanticDeleted = IDomainEvent<NodeSemanticDeletedData> & {
  eventType: "NodeSemanticDeleted";
};

export type EdgeSemanticDeleted = IDomainEvent<EdgeSemanticDeletedData> & {
  eventType: "EdgeSemanticDeleted";
};

export type NodeTagUpdated = IDomainEvent<NodeTagUpdatedData> & {
  eventType: "NodeTagUpdated";
};

export type NodeTagDeleted = IDomainEvent<NodeTagDeletedData> & {
  eventType: "NodeTagDeleted";
};
