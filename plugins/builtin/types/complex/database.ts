// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `database` node type.
 *
 * The content is the node's own table: fields, rows and the presentation views
 * attached to it. `DATABASE_FIELD_TYPES` is the plugin's copy of the canonical
 * field-type list; the tRPC schema and the domain value objects still read the
 * interfaces copy until plan todo 20 collapses it.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";
import type { DataView } from "@workspace/interfaces/models/data-view";
import type { NodeId } from "@workspace/interfaces/models/node/base";

export type { DatabaseNodeData } from "@workspace/interfaces/models/node/nodes/complex/database";

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
  /** Required non-empty for select / multiSelect; preserved for every other type. */
  options?: DatabaseFieldOption[];
  /** Whether a date field includes hours and minutes; omitted means date only. */
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
  /** Cell values keyed by {@link DatabaseField.id}. */
  cells: Record<string, DatabaseCell>;
}

export interface DatabaseContent {
  fields: DatabaseField[];
  rows: DatabaseRow[];
  views?: DataView[];
}

const fieldOptionSchema: JsonSchema = {
  type: "object",
  required: ["id", "name"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    color: { type: "string" },
  },
  additionalProperties: false,
};

const fieldSchema: JsonSchema = {
  type: "object",
  required: ["id", "name", "type"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    type: { type: "string", enum: [...DATABASE_FIELD_TYPES] },
    options: { type: "array", items: fieldOptionSchema },
    includeTime: { type: "boolean" },
  },
  additionalProperties: false,
};

const cellSchema: JsonSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: { type: "string" },
  },
};

const rowSchema: JsonSchema = {
  type: "object",
  required: ["id", "cells"],
  properties: {
    id: { type: "string" },
    cells: { type: "object", additionalProperties: cellSchema },
  },
  additionalProperties: false,
};

export const databaseSchema: JsonSchema = {
  type: "object",
  required: ["fields", "rows"],
  properties: {
    fields: { type: "array", items: fieldSchema },
    rows: { type: "array", items: rowSchema },
    views: { type: "array", items: { type: "object" } },
  },
  additionalProperties: false,
};

/** A database with no fields, no rows and no views. */
export function createDatabaseContent(): DatabaseContent {
  return { fields: [], rows: [] };
}
