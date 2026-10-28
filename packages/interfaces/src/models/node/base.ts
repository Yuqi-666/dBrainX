// SPDX-License-Identifier: AGPL-3.0-only

export type Permission = "private" | "public" | "restricted";

export type NodeSemanticId = string;
export interface NodeSemantic {
  id: NodeSemanticId;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  workspaceId?: string;
}

export type NodeTagId = string;
export interface NodeTag {
  id: NodeTagId;
  name: string;
  color?: string;
  workspaceId?: string;
}

export type NodeId = string;

/**
 * The icon a node shows in list rows, cards, preview headers and the editor.
 *
 * `kind` is the discriminant. `value` means, per member:
 * - `"emoji"` — the character itself;
 * - `"icon"` — a Lucide graphic name, same convention as {@link NodeSemantic.icon};
 * - `"image"` — a stored file path, run through `resolveFileUrl` when rendered.
 */
export interface NodeIcon {
  kind: "emoji" | "icon" | "image";
  value: string;
  /** Background / foreground colour as hex (`"#6366f1"`); omitted means no background. */
  color?: string;
}

/**
 * The cover a node shows on cards and previews.
 *
 * Structurally the same as dataview's `CardCover`, but the discriminant is named
 * differently (`"image"` here vs `"url"` there) — the two are not
 * interchangeable, they are both digested by `NodePreviewCover`.
 */
export type NodeCover =
  | { kind: "image"; url: string }
  | { kind: "node"; nodeId: NodeId };

export type PositionMode = "force" | "flow";

export interface PositionEntry {
  viewId: string;
  x: number;
  y: number;
  mode: PositionMode;
}

export interface NodeClientStyle {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  labelColor?: string;
  labelSize?: number;
  radius?: number;
}

export interface NodeClientState {
  position?: PositionEntry[];
  style?: NodeClientStyle;
  [key: string]: unknown;
}

export interface NodeServerState {
  weight?: number;
  [key: string]: unknown;
}

export interface NodeStateData {
  client: NodeClientState;
  server: NodeServerState;
}

export interface NodeBase {
  id: NodeId;
  title: string;
  abstract?: string;
  permission: Permission;
  semanticId: NodeSemanticId;
  tags?: NodeTagId[];
  isPinned?: boolean;
  /**
   * Display icon; when absent the consumers fall back to the node type's icon.
   *
   * **`null` is a write-only sentinel meaning "clear this field"** (M1 / R29).
   * The server applies it as a removal, and the read path never returns `null` —
   * an absent icon comes back as `undefined`. It exists because the whole-node
   * update path cannot express removal with `undefined`: the client merges
   * `{ ...oldNode, ...updates }` and the server decides value-by-value, so
   * `{ icon: undefined }` is indistinguishable from "do not touch this field".
   * Consumers must treat `null` and `undefined` identically (`node.icon ?? fallback`).
   */
  icon?: NodeIcon | null;
  /** Display cover; when absent the consumers derive one from the node type. See {@link NodeBase.icon} for the `null` sentinel. */
  cover?: NodeCover | null;
  workspaceId?: string;
  stateData?: NodeStateData;
  createdAt: string;
  updatedAt: string;
}
