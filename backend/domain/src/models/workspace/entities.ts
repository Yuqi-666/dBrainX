// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeIcon } from "@workspace/interfaces";
import { WORKSPACE_NAME_MAX_LENGTH } from "@workspace/utils/workspace";
import { WorkspaceId, WorkspaceMemberId } from "./value-objects";
import { normalizeWorkspaceName } from "./name";

interface WorkspaceProps {
  id: WorkspaceId;
  name: string;
  ownerId: string;
  /** Display icon; `null` clears it and `undefined` reads as "no icon". */
  icon?: NodeIcon | null;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Workspace entity - represents a workspace container
 *
 * The name is normalized and validated on every construction, so `create` and
 * `updateName` cannot persist a blank or over-long name.
 * `isDefault` marks the workspace the server provisions on first login; it is
 * server-owned and only the provisioning path sets it.
 * `icon` is the picker icon; only the `emoji` and `icon` kinds are stored, and
 * the constructor normalises `null` to `undefined` like the node entity does.
 * All properties are readonly - use update methods to create new instances
 */
export class Workspace {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly ownerId: string;
  readonly icon?: NodeIcon;
  readonly isDefault: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;

  private constructor(props: WorkspaceProps) {
    this.id = props.id;
    this.name = normalizeWorkspaceName(props.name, WORKSPACE_NAME_MAX_LENGTH);
    this.ownerId = props.ownerId;
    this.icon = props.icon ?? undefined;
    this.isDefault = props.isDefault ?? false;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /**
   * Creates a new Workspace entity
   */
  static create(props: {
    id: string | WorkspaceId;
    name: string;
    ownerId: string;
    icon?: NodeIcon | null;
    isDefault?: boolean;
    createdAt?: string;
    updatedAt?: string;
  }): Workspace {
    const id =
      typeof props.id === "string" ? WorkspaceId.create(props.id) : props.id;
    return new Workspace({
      id,
      name: props.name,
      ownerId: props.ownerId,
      icon: props.icon,
      isDefault: props.isDefault,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  /**
   * Checks if this Workspace has the same identity as another Workspace
   */
  sameIdentityAs(other: Workspace): boolean {
    return this.id.equals(other.id);
  }

  /**
   * Creates a copy with updated name
   * @throws Error if the trimmed name is empty or longer than the shared limit
   */
  updateName(name: string): Workspace {
    return new Workspace({
      id: this.id,
      name,
      ownerId: this.ownerId,
      icon: this.icon,
      isDefault: this.isDefault,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }

  /**
   * Creates a copy with a new icon, or without one when `icon` is `null`.
   * The `null` sentinel is required because `undefined` means "leave it alone"
   * on the update path.
   */
  updateIcon(icon: NodeIcon | null): Workspace {
    return new Workspace({
      id: this.id,
      name: this.name,
      ownerId: this.ownerId,
      icon,
      isDefault: this.isDefault,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }
}

/** WorkspaceRole - role of a member within a workspace */
export type WorkspaceRole = "owner" | "editor" | "viewer";

interface WorkspaceMemberProps {
  id: WorkspaceMemberId;
  workspaceId: WorkspaceId;
  userId: string;
  role: WorkspaceRole;
  createdAt?: string;
}

/**
 * WorkspaceMember entity - represents a member of a workspace
 * All properties are readonly - use update methods to create new instances
 */
export class WorkspaceMember {
  readonly id: WorkspaceMemberId;
  readonly workspaceId: WorkspaceId;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly createdAt?: string;

  private constructor(props: WorkspaceMemberProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.userId = props.userId;
    this.role = props.role;
    this.createdAt = props.createdAt;
  }

  /**
   * Creates a new WorkspaceMember entity
   */
  static create(props: {
    id: string | WorkspaceMemberId;
    workspaceId: string | WorkspaceId;
    userId: string;
    role: WorkspaceRole;
    createdAt?: string;
  }): WorkspaceMember {
    const id =
      typeof props.id === "string"
        ? WorkspaceMemberId.create(props.id)
        : props.id;
    const workspaceId =
      typeof props.workspaceId === "string"
        ? WorkspaceId.create(props.workspaceId)
        : props.workspaceId;
    return new WorkspaceMember({
      id,
      workspaceId,
      userId: props.userId,
      role: props.role,
      createdAt: props.createdAt,
    });
  }

  /**
   * Checks if this WorkspaceMember has the same identity as another WorkspaceMember
   */
  sameIdentityAs(other: WorkspaceMember): boolean {
    return this.id.equals(other.id);
  }

  /**
   * Creates a copy with updated role
   */
  updateRole(role: WorkspaceRole): WorkspaceMember {
    return new WorkspaceMember({
      id: this.id,
      workspaceId: this.workspaceId,
      userId: this.userId,
      role,
      createdAt: this.createdAt,
    });
  }
}
