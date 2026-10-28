// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Value object representing a unique Edge identifier.
 * Wraps a string with UUID format validation.
 */
export class EdgeId {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /**
   * Creates an EdgeId value object.
   * @param value - The string identifier (preferably UUID format)
   * @throws Error if value is empty or not a valid UUID
   */
  static create(value: string): EdgeId {
    if (!value || value.trim() === "") {
      throw new Error("EdgeId cannot be empty");
    }

    return new EdgeId(value);
  }

  /**
   * Gets the underlying string value.
   */
  getValue(): string {
    return this.value;
  }

  equals(other: EdgeId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * Value object representing the direction of an edge connection.
 * Defines how data or relationships flow between nodes.
 */
export class EdgeDirection {
  private readonly value: "forward" | "reverse" | "bidirectional" | "undirected";

  private constructor(value: "forward" | "reverse" | "bidirectional" | "undirected") {
    this.value = value;
  }

  /**
   * Creates a forward direction (from → to).
   */
  static forward(): EdgeDirection {
    return new EdgeDirection("forward");
  }

  /**
   * Creates a reverse direction (to ← from).
   */
  static reverse(): EdgeDirection {
    return new EdgeDirection("reverse");
  }

  /**
   * Creates a bidirectional direction (from ↔ to).
   */
  static bidirectional(): EdgeDirection {
    return new EdgeDirection("bidirectional");
  }

  /**
   * Creates a undirected direction (from - to).
   */
  static undirected(): EdgeDirection {
    return new EdgeDirection("undirected");
  }

  /**
   * Gets the underlying string value.
   */
  getValue(): "forward" | "reverse" | "bidirectional" | "undirected" {
    return this.value;
  }

  /**
   * Checks if direction is forward.
   */
  isForward(): boolean {
    return this.value === "forward";
  }

  /**
   * Checks if direction is reverse.
   */
  isReverse(): boolean {
    return this.value === "reverse";
  }

  /**
   * Checks if direction is bidirectional.
   */
  isBidirectional(): boolean {
    return this.value === "bidirectional";
  }

  /**
   * Checks if direction is undirected.
   */
  isUndirected(): boolean {
    return this.value === "undirected";
  }

  /**
   * Validates if this direction can connect to another direction.
   * Bidirectional can connect to any direction.
   * Forward can only connect to reverse.
   * Reverse can only connect to forward.
   */
  canConnectTo(other: EdgeDirection): boolean {
    if (this.isBidirectional() || other.isBidirectional()) {
      return true;
    }
    return this.value !== other.value;
  }

  equals(other: EdgeDirection): boolean {
    return this.value === other.value;
  }
}

/**
 * Value object representing the type/category of edge relationship.
 * Defines the semantic meaning of the connection.
 */
export class EdgeType {
  private readonly value: "hierarchy" | "flow" | "association" | "interaction";

  private constructor(
    value: "hierarchy" | "flow" | "association" | "interaction",
  ) {
    this.value = value;
  }

  /**
   * Creates a hierarchy edge type (parent-child relationship).
   */
  static hierarchy(): EdgeType {
    return new EdgeType("hierarchy");
  }

  /**
   * Creates a flow edge type (data/process flow).
   */
  static flow(): EdgeType {
    return new EdgeType("flow");
  }

  /**
   * Creates an association edge type (loosely connected).
   */
  static association(): EdgeType {
    return new EdgeType("association");
  }

  /**
   * Creates an interaction edge type (user/system interaction).
   */
  static interaction(): EdgeType {
    return new EdgeType("interaction");
  }

  /**
   * Gets the underlying string value.
   */
  getValue(): "hierarchy" | "flow" | "association" | "interaction" {
    return this.value;
  }

  /**
   * Gets the localized label for the edge type.
   */
  getLabel(): string {
    switch (this.value) {
      case "hierarchy":
        return "层级";
      case "flow":
        return "流动";
      case "association":
        return "关联";
      case "interaction":
        return "交互";
    }
  }

  equals(other: EdgeType): boolean {
    return this.value === other.value;
  }
}

/**
 * Type alias for Node ID (imported from interfaces package)
 */
export type EdgeSemanticId = string;
