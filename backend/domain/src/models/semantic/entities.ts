// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain Entities for Semantic Classification
 *
 * Rich domain models implementing business logic for semantic types and tags.
 */

import type { EdgeType } from "@workspace/interfaces/models/edge";
import { SemanticId, TagId } from "./value-objects";

/**
 * Entity representing a semantic classification for nodes
 *
 * Encapsulates the logic for categorizing nodes with visual and semantic metadata.
 */
export class NodeSemantic {
  readonly id: SemanticId;
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
  readonly icon?: string;
  readonly workspaceId?: string;

  private constructor(props: {
    id: SemanticId;
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    workspaceId?: string;
  }) {
    if (!props.name || props.name.trim().length === 0) {
      throw new Error("NodeSemantic: name cannot be empty or blank");
    }
    this.id = props.id;
    this.name = props.name.trim();
    this.description = props.description?.trim();
    this.color = props.color?.trim();
    this.icon = props.icon?.trim();
    this.workspaceId = props.workspaceId;
  }

  /**
   * Factory method to create a NodeSemantic
   * @param props - The properties for the node semantic
   * @returns A new NodeSemantic instance
   */
  static create(props: {
    id: SemanticId;
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    workspaceId?: string;
  }): NodeSemantic {
    return new NodeSemantic(props);
  }

  /**
   * Checks identity equality with another NodeSemantic
   * @param other - Another NodeSemantic to compare
   * @returns True if both have the same semantic ID
   */
  sameIdentityAs(other: NodeSemantic): boolean {
    return this.id.equals(other.id);
  }

  /**
   * Updates multiple properties at once (immutable)
   * @param props - Properties to update
   * @returns A new NodeSemantic instance with updated properties
   */
  update(props: {
    name?: string;
    description?: string;
    color?: string;
    icon?: string;
  }): NodeSemantic {
    return new NodeSemantic({
      id: this.id,
      name: props.name ?? this.name,
      description:
        props.description !== undefined ? props.description : this.description,
      color: props.color !== undefined ? props.color : this.color,
      icon: props.icon !== undefined ? props.icon : this.icon,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Updates the color (immutable)
   * @param color - The new color
   * @returns A new NodeSemantic instance with updated color
   */
  setColor(color: string): NodeSemantic {
    return this.update({ color });
  }

  /**
   * Updates the icon (immutable)
   * @param icon - The new icon
   * @returns A new NodeSemantic instance with updated icon
   */
  setIcon(icon: string): NodeSemantic {
    return this.update({ icon });
  }

  /**
   * Removes the description (immutable)
   * @returns A new NodeSemantic instance without description
   */
  clearDescription(): NodeSemantic {
    return this.update({ description: undefined });
  }
}

/**
 * Entity representing a semantic classification for edges
 *
 * Encapsulates the logic for categorizing relationships with type-based semantics.
 */
export class EdgeSemantic {
  readonly id: SemanticId;
  readonly name: string;
  readonly category: EdgeType;
  readonly color?: string;
  readonly icon?: string;
  readonly description?: string;
  readonly workspaceId?: string;

  private constructor(props: {
    id: SemanticId;
    name: string;
    category: EdgeType;
    color?: string;
    icon?: string;
    description?: string;
    workspaceId?: string;
  }) {
    if (!props.name || props.name.trim().length === 0) {
      throw new Error("EdgeSemantic: name cannot be empty or blank");
    }
    if (!props.category) {
      throw new Error("EdgeSemantic: category is required");
    }
    this.id = props.id;
    this.name = props.name.trim();
    this.category = props.category;
    this.color = props.color?.trim();
    this.icon = props.icon?.trim();
    this.description = props.description?.trim();
    this.workspaceId = props.workspaceId;
  }

  /**
   * Factory method to create an EdgeSemantic
   * @param props - The properties for the edge semantic
   * @returns A new EdgeSemantic instance
   */
  static create(props: {
    id: SemanticId;
    name: string;
    category: EdgeType;
    color?: string;
    icon?: string;
    description?: string;
    workspaceId?: string;
  }): EdgeSemantic {
    return new EdgeSemantic(props);
  }

  /**
   * Checks identity equality with another EdgeSemantic
   * @param other - Another EdgeSemantic to compare
   * @returns True if both have the same semantic ID
   */
  sameIdentityAs(other: EdgeSemantic): boolean {
    return this.id.equals(other.id);
  }

  /**
   * Updates multiple properties at once (immutable)
   * @param props - Properties to update
   * @returns A new EdgeSemantic instance with updated properties
   */
  update(props: {
    name?: string;
    category?: EdgeType;
    color?: string;
    icon?: string;
    description?: string;
  }): EdgeSemantic {
    return new EdgeSemantic({
      id: this.id,
      name: props.name ?? this.name,
      category: props.category ?? this.category,
      color: props.color !== undefined ? props.color : this.color,
      icon: props.icon !== undefined ? props.icon : this.icon,
      description:
        props.description !== undefined ? props.description : this.description,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Updates the color (immutable)
   * @param color - The new color
   * @returns A new EdgeSemantic instance with updated color
   */
  setColor(color: string): EdgeSemantic {
    return this.update({ color });
  }

  /**
   * Updates the description (immutable)
   * @param description - The new description
   * @returns A new EdgeSemantic instance with updated description
   */
  setDescription(description: string): EdgeSemantic {
    return this.update({ description });
  }
}

/**
 * Entity representing a tag for nodes
 *
 * Encapsulates the logic for node tagging with optional visual metadata.
 */
export class NodeTag {
  readonly id: TagId;
  readonly name: string;
  readonly color?: string;
  readonly workspaceId?: string;

  private constructor(props: { id: TagId; name: string; color?: string; workspaceId?: string }) {
    if (!props.name || props.name.trim().length === 0) {
      throw new Error("NodeTag: name cannot be empty or blank");
    }
    this.id = props.id;
    this.name = props.name.trim();
    this.color = props.color?.trim();
    this.workspaceId = props.workspaceId;
  }

  /**
   * Factory method to create a NodeTag
   * @param props - The properties for the node tag
   * @returns A new NodeTag instance
   */
  static create(props: { id: TagId; name: string; color?: string; workspaceId?: string }): NodeTag {
    return new NodeTag(props);
  }

  /**
   * Checks identity equality with another NodeTag
   * @param other - Another NodeTag to compare
   * @returns True if both have the same tag ID
   */
  sameIdentityAs(other: NodeTag): boolean {
    return this.id.equals(other.id);
  }

  /**
   * Updates multiple properties at once (immutable)
   * @param props - Properties to update
   * @returns A new NodeTag instance with updated properties
   */
  update(props: { name?: string; color?: string }): NodeTag {
    return new NodeTag({
      id: this.id,
      name: props.name ?? this.name,
      color: props.color !== undefined ? props.color : this.color,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Updates the color (immutable)
   * @param color - The new color
   * @returns A new NodeTag instance with updated color
   */
  setColor(color: string): NodeTag {
    return this.update({ color });
  }
}
