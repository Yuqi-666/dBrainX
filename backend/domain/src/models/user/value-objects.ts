// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Value Objects for User aggregate.
 * Immutable types with validation and equality checks.
 */

import type { UserId as UserIdType } from "@workspace/interfaces/models/user/base";

/**
 * Value Object representing a User ID.
 * Immutable wrapper for user identifier with validation.
 */
export class UserId {
  private readonly _value: UserIdType;

  constructor(value: UserIdType) {
    if (!value || value.trim().length === 0) {
      throw new Error("UserId cannot be empty");
    }
    this._value = value;
  }

  get value(): UserIdType {
    return this._value;
  }

  equals(other: UserId): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  static create(value: UserIdType): UserId {
    return new UserId(value);
  }
}

/**
 * Value Object representing a user's email address.
 * Validates email format on construction.
 */
export class Email {
  private readonly _value: string;

  constructor(value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error("Email cannot be empty");
    }
    this._value = value.toLowerCase();
  }

  get value(): string {
    return this._value;
  }

  equals(other: Email): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}

/**
 * Value Object representing a user's nickname.
 * Non-empty display name with optional length constraints.
 */
export class Nickname {
  private readonly _value: string;

  constructor(value: string, maxLength: number = 50) {
    if (!value || value.trim().length === 0) {
      throw new Error("Nickname cannot be empty");
    }
    if (value.length > maxLength) {
      throw new Error(`Nickname cannot exceed ${maxLength} characters`);
    }
    this._value = value.trim();
  }

  get value(): string {
    return this._value;
  }

  equals(other: Nickname): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}

/**
 * Value Object representing user's system configuration.
 * JSON object stored as immutable value.
 */
export class SystemConfig {
  private readonly _value: Record<string, unknown>;

  constructor(value: Record<string, unknown> = {}) {
    this._value = Object.freeze({ ...value });
  }

  get value(): Record<string, unknown> {
    return { ...this._value };
  }

  get<K extends string>(key: K): unknown {
    return this._value[key];
  }

  has(key: string): boolean {
    return key in this._value;
  }

  equals(other: SystemConfig): boolean {
    return JSON.stringify(this._value) === JSON.stringify(other._value);
  }

  toString(): string {
    return JSON.stringify(this._value);
  }
}

/**
 * Value Object representing a username for login.
 * Used by PocketBase auth - must be unique.
 */
export class Username {
  private readonly _value: string;

  constructor(value: string, minLength: number = 3, maxLength: number = 50) {
    if (!value || value.trim().length === 0) {
      throw new Error("Username cannot be empty");
    }
    if (value.length < minLength) {
      throw new Error(`Username must be at least ${minLength} characters`);
    }
    if (value.length > maxLength) {
      throw new Error(`Username cannot exceed ${maxLength} characters`);
    }
    this._value = value.toLowerCase().trim();
  }

  get value(): string {
    return this._value;
  }

  equals(other: Username): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
