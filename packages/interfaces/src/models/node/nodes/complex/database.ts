// SPDX-License-Identifier: AGPL-3.0-only

import type { DataView } from "../../../data-view";
import type { NodeBase, NodeId } from "../../base";
import type { NodeType } from "../../types";

export interface DatabaseNodeData extends NodeBase, NodeType<"database"> {
  content: DatabaseContent;
}

/**
 * Every field type a database column may declare.
 *
 * This runtime list is the SINGLE source of truth for the field-type set: the
 * `DatabaseFieldType` union below is derived from it, the domain value objects
 * re-export it, and the tRPC schema builds its enum from it. Adding a type means
 * touching this array, the `DatabaseCell` union and the render switch — nothing
 * else needs a new literal list. (Same pattern as `NODE_DATA_TYPES`.)
 */
export const DATABASE_FIELD_TYPES = [
  "text",
  "number",
  "select",
  "multiSelect",
  "date",
  "checkbox",
  "url",
  "relation",
] as const;

export type DatabaseFieldType = (typeof DATABASE_FIELD_TYPES)[number];

export interface DatabaseFieldOption {
  id: string;
  name: string;
  color?: string;
}

export interface DatabaseField {
  id: string;
  name: string;
  type: DatabaseFieldType;
  /**
   * select / multiSelect 的选项列表（这两种类型必须非空）。
   * 其它类型不要求带 `options`，但一旦带上就原样保留（避免整表往返时丢数据），
   * 其中的 `id` 唯一性同样会校验。
   */
  options?: DatabaseFieldOption[];
  /** 日期字段是否包含小时和分钟；省略时仅显示日期。 */
  includeTime?: boolean;
}

export type DatabaseCell =
  | { type: "text"; text: string }
  | { type: "number"; number: number | null }
  | { type: "select"; optionId: string | null }
  | { type: "multiSelect"; optionIds: string[] }
  | { type: "date"; date: string | null }
  | { type: "checkbox"; checked: boolean }
  | { type: "url"; url: string | null }
  | { type: "relation"; nodeIds: NodeId[] };

export interface DatabaseRow {
  id: string;
  /** 单元格值，按 DatabaseField.id 键 */
  cells: Record<string, DatabaseCell>;
}

export interface DatabaseContent {
  fields: DatabaseField[];
  rows: DatabaseRow[];
  /**
   * Data views attached to this node (see `docs/dataview/README.md`).
   *
   * Views are a property of how the node looks at its own table, so they live
   * on content rather than in a separate entity. Optional: a node created
   * before data views existed simply has none.
   */
  views?: DataView[];
}
