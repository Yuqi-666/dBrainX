// SPDX-License-Identifier: AGPL-3.0-only

import type { EventMetadata } from "./types";

export interface IDomainEvent<T = unknown> {
  readonly eventType: string;
  readonly aggregateId: string;
  readonly metadata: EventMetadata;
  readonly data: T;
}

export interface IEventBus {
  publish<T>(event: IDomainEvent<T>): void;
  subscribe<T>(
    eventType: string,
    handler: (event: IDomainEvent<T>) => void,
  ): () => void;
  unsubscribe(eventType: string): void;
}

export abstract class DomainEvent<T = unknown> implements IDomainEvent<T> {
  abstract readonly eventType: string;
  abstract readonly data: T;

  readonly aggregateId: string;
  readonly metadata: EventMetadata;

  constructor(aggregateId: string, userId?: string) {
    this.aggregateId = aggregateId;
    this.metadata = {
      occurredAt: new Date().toISOString(),
      eventVersion: 1,
      userId: userId ?? "system",
    };
  }
}
