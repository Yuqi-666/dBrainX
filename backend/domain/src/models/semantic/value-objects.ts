// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Value Objects for Semantic Domain
 *
 * Immutable wrappers for semantic and tag identifiers with validation.
 */

/**
 * Error thrown when an invalid semantic ID is provided
 */
export class InvalidSemanticIdError extends Error {
  constructor(value: string) {
    super(
      `Invalid semantic ID: cannot be empty or blank. Received: "${value}"`,
    );
    this.name = "InvalidSemanticIdError";
  }
}

/**
 * Error thrown when an invalid tag ID is provided
 */
export class InvalidTagIdError extends Error {
  constructor(value: string) {
    super(`Invalid tag ID: cannot be empty or blank. Received: "${value}"`);
    this.name = "InvalidTagIdError";
  }
}

/**
 * Value Object representing a semantic identifier (NodeSemanticId or EdgeSemanticId)
 *
 * Encapsulates the validation and ensures immutability of semantic IDs.
 */
export class SemanticId {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  /**
   * Factory method to create a SemanticId
   * @param value - The string value to wrap
   * @throws InvalidSemanticIdError if value is empty or blank
   * @returns A new SemanticId instance
   */
  static create(value: string): SemanticId {
    if (!value || value.trim().length === 0) {
      throw new InvalidSemanticIdError(value);
    }
    return new SemanticId(value.trim());
  }

  /**
   * Gets the underlying string value
   * @returns The semantic ID value
   */
  getValue(): string {
    return this._value;
  }

  /**
   * Checks equality with another SemanticId
   * @param other - Another SemanticId to compare
   * @returns True if values are equal
   */
  equals(other: SemanticId): boolean {
    return this._value === other._value;
  }

  /**
   * String representation for debugging
   * @returns The semantic ID value
   */
  toString(): string {
    return this._value;
  }
}

/**
 * Value Object representing a tag identifier (NodeTagId)
 *
 * Encapsulates the validation and ensures immutability of tag IDs.
 */
export class TagId {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  /**
   * Factory method to create a TagId
   * @param value - The string value to wrap
   * @throws InvalidTagIdError if value is empty or blank
   * @returns A new TagId instance
   */
  static create(value: string): TagId {
    if (!value || value.trim().length === 0) {
      throw new InvalidTagIdError(value);
    }
    return new TagId(value.trim());
  }

  /**
   * Gets the underlying string value
   * @returns The tag ID value
   */
  getValue(): string {
    return this._value;
  }

  /**
   * Checks equality with another TagId
   * @param other - Another TagId to compare
   * @returns True if values are equal
   */
  equals(other: TagId): boolean {
    return this._value === other._value;
  }

  /**
   * String representation for debugging
   * @returns The tag ID value
   */
  toString(): string {
    return this._value;
  }
}
