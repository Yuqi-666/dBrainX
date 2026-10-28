// SPDX-License-Identifier: AGPL-3.0-only

import type { IDomainEvent } from "@workspace/domain/event-bus";
import { container } from "./container";
import { eventEmitter } from "../trpc/server";

const ALL_EVENTS = [
  "NodeCreated",
  "NodeUpdated",
  "NodeDeleted",
  "EdgeCreated",
  "EdgeUpdated",
  "EdgeDeleted",
  "ViewCreated",
  "ViewUpdated",
  "ViewDeleted",
  "NodeSemanticCreated",
  "NodeSemanticUpdated",
  "NodeSemanticDeleted",
  "EdgeSemanticCreated",
  "EdgeSemanticUpdated",
  "EdgeSemanticDeleted",
  "NodeTagCreated",
  "NodeTagUpdated",
  "NodeTagDeleted",
  "WorkspaceCreated",
  "WorkspaceUpdated",
  "WorkspaceDeleted",
  "WorkspaceMemberAdded",
  "WorkspaceMemberRemoved",
  "DashboardUpdated",
] as const;

const unsubscribers: Array<() => void> = [];

export function initializeEventBridge(): void {
  const eventBus = container().eventBus;

  for (const eventType of ALL_EVENTS) {
    const unsubscribe = eventBus.subscribe(eventType, (event: IDomainEvent) => {
      eventEmitter.emit(event);
    });
    unsubscribers.push(unsubscribe);
  }
}

export function destroyEventBridge(): void {
  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
  unsubscribers.length = 0;
}
