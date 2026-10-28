// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WorkspaceId value object - wraps a string with validation
 */
export class WorkspaceId {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  /**
   * Creates a new WorkspaceId
   * @throws Error if value is empty
   */
  static create(value: string): WorkspaceId {
    if (!value || value.trim().length === 0) {
      throw new Error("WorkspaceId cannot be empty");
    }
    return new WorkspaceId(value);
  }

  /**
   * Gets the underlying string value
   */
  get value(): string {
    return this._value;
  }

  /**
   * Checks if two WorkspaceIds are equal
   */
  equals(other: WorkspaceId): boolean {
    return this._value === other._value;
  }

  /**
   * Returns the string representation
   */
  toString(): string {
    return this._value;
  }
}

/**
 * WorkspaceMemberId value object - wraps a string with validation
 */
export class WorkspaceMemberId {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  /**
   * Creates a new WorkspaceMemberId
   * @throws Error if value is empty
   */
  static create(value: string): WorkspaceMemberId {
    if (!value || value.trim().length === 0) {
      throw new Error("WorkspaceMemberId cannot be empty");
    }
    return new WorkspaceMemberId(value);
  }

  /**
   * Gets the underlying string value
   */
  get value(): string {
    return this._value;
  }

  /**
   * Checks if two WorkspaceMemberIds are equal
   */
  equals(other: WorkspaceMemberId): boolean {
    return this._value === other._value;
  }

  /**
   * Returns the string representation
   */
  toString(): string {
    return this._value;
  }
}
