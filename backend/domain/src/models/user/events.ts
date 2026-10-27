// SPDX-License-Identifier: AGPL-3.0-only

import type { IDomainEvent } from "../../event-bus";
import type { EventMetadata } from "../../event-bus/types";

export interface UserCreatedData {
  userId: string;
  email: string;
  nickname: string;
}

export interface UserLoggedInData {
  userId: string;
  email: string;
  loginAt: string;
}

export interface UserUpdatedData {
  userId: string;
  field: "nickname" | "avatar" | "systemConfig";
}

export type UserCreated = IDomainEvent<UserCreatedData> & {
  eventType: "UserCreated";
};

export type UserLoggedIn = IDomainEvent<UserLoggedInData> & {
  eventType: "UserLoggedIn";
};

export type UserUpdated = IDomainEvent<UserUpdatedData> & {
  eventType: "UserUpdated";
};

export function createUserCreatedEvent(
  userId: string,
  email: string,
  nickname: string,
  metadata: EventMetadata,
): UserCreated {
  return {
    eventType: "UserCreated",
    aggregateId: userId,
    metadata,
    data: { userId, email, nickname },
  };
}

export function createUserLoggedInEvent(
  userId: string,
  email: string,
  loginAt: string,
  metadata: EventMetadata,
): UserLoggedIn {
  return {
    eventType: "UserLoggedIn",
    aggregateId: userId,
    metadata,
    data: { userId, email, loginAt },
  };
}

export function createUserUpdatedEvent(
  userId: string,
  field: "nickname" | "avatar" | "systemConfig",
  metadata: EventMetadata,
): UserUpdated {
  return {
    eventType: "UserUpdated",
    aggregateId: userId,
    metadata,
    data: { userId, field },
  };
}
