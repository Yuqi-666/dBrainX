// SPDX-License-Identifier: AGPL-3.0-only

import { ViewId, VisualConfig, ViewType } from "./value-objects";
import { FilterConfig } from "../filter/value-objects";
interface ViewProps {
  id: ViewId;
  name: string;
  viewType: ViewType;
  visualConfig: VisualConfig;
  filterConfig: FilterConfig;
  isPinned: boolean;
  isDefault?: boolean;
  workspaceId?: string;
}

/**
 * View entity - represents a graph view with type and visual configuration
 *
 * `isDefault` marks the global view the server creates with its workspace; it
 * is server-owned and only the provisioning paths set it.
 * All properties are readonly - use update methods to create new instances
 */
export class View {
  readonly id: ViewId;
  readonly name: string;
  readonly viewType: ViewType;
  readonly visualConfig: VisualConfig;
  readonly filterConfig: FilterConfig;
  readonly isPinned: boolean;
  readonly isDefault: boolean;
  readonly workspaceId?: string;

  private constructor(props: ViewProps) {
    this.id = props.id;
    this.name = props.name;
    this.viewType = props.viewType;
    this.visualConfig = props.visualConfig;
    this.filterConfig = props.filterConfig;
    this.isPinned = props.isPinned ?? false;
    this.isDefault = props.isDefault ?? false;
    this.workspaceId = props.workspaceId;
  }

  /**
   * Creates a new View entity
   */
  static create(props: {
    id: string | ViewId;
    name: string;
    viewType: ViewType | string;
    visualConfig: VisualConfig;
    filterConfig: FilterConfig;
    isPinned?: boolean;
    isDefault?: boolean;
    workspaceId?: string;
  }): View {
    const id =
      typeof props.id === "string" ? ViewId.create(props.id) : props.id;
    const viewType =
      typeof props.viewType === "string"
        ? ViewType.fromString(props.viewType)
        : props.viewType;
    const visualConfig =
      props.visualConfig instanceof VisualConfig
        ? props.visualConfig
        : VisualConfig.create(props.visualConfig);

    return new View({
      id,
      name: props.name,
      viewType,
      visualConfig,
      filterConfig: props.filterConfig,
      isPinned: props.isPinned ?? false,
      isDefault: props.isDefault,
      workspaceId: props.workspaceId,
    });
  }

  /**
   * Checks if this View has the same identity as another View
   */
  sameIdentityAs(other: View): boolean {
    return this.id.equals(other.id);
  }

  /**
   * Creates a copy with updated name
   */
  updateName(name: string): View {
    return new View({
      id: this.id,
      name,
      viewType: this.viewType,
      visualConfig: this.visualConfig,
      filterConfig: this.filterConfig,
      isPinned: this.isPinned,
      isDefault: this.isDefault,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Creates a copy with updated view type
   */
  updateViewType(viewType: ViewType): View {
    return new View({
      id: this.id,
      name: this.name,
      viewType,
      visualConfig: this.visualConfig,
      filterConfig: this.filterConfig,
      isPinned: this.isPinned,
      isDefault: this.isDefault,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Creates a copy with updated visual configuration
   */
  updateVisualConfig(config: VisualConfig): View {
    return new View({
      id: this.id,
      name: this.name,
      viewType: this.viewType,
      visualConfig: config,
      filterConfig: this.filterConfig,
      isPinned: this.isPinned,
      isDefault: this.isDefault,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Creates a copy with updated filter configuration
   */
  updateFilterConfig(config: FilterConfig): View {
    return new View({
      id: this.id,
      name: this.name,
      viewType: this.viewType,
      visualConfig: this.visualConfig,
      filterConfig: config,
      isPinned: this.isPinned,
      isDefault: this.isDefault,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Creates a pinned copy of this View
   */
  pin(): View {
    if (this.isPinned) return this;
    return new View({
      id: this.id,
      name: this.name,
      viewType: this.viewType,
      visualConfig: this.visualConfig,
      filterConfig: this.filterConfig,
      isPinned: true,
      isDefault: this.isDefault,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Creates an unpinned copy of this View
   */
  unpin(): View {
    if (!this.isPinned) return this;
    return new View({
      id: this.id,
      name: this.name,
      viewType: this.viewType,
      visualConfig: this.visualConfig,
      filterConfig: this.filterConfig,
      isPinned: false,
      isDefault: this.isDefault,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Checks if this View has active filter rules
   */
  hasActiveFilter(): boolean {
    return (
      (this.filterConfig.selectedNodes !== undefined &&
        this.filterConfig.selectedNodes.length > 0) ||
      this.filterConfig.ruleGroup !== undefined ||
      this.filterConfig.collectionType !== undefined
    );
  }
}
