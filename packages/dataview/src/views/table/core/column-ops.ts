// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * Pure `TableViewConfig` operations behind the 字段配置 menu: reordering,
 * grouping, showing/hiding and adding/removing fields.
 *
 * Keeping them here (instead of inside the menu component) keeps the tricky
 * part — "a group is a contiguous block, but `config.columns` is the single
 * ordering source" — reviewable on its own.
 */
import type {
  DatabaseCell,
  DatabaseField,
  DataRow,
  TableColumnConfig,
  TableColumnGroup,
  TableViewConfig,
} from "@workspace/interfaces";

import { deleteFieldSchema, editFieldSchema } from "../../../source/row-utils";
import {
  orderColumnsByGroups,
  resolveTableColumns,
  validColumnGroups,
} from "./schema";

function createGroupId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `grp_${globalCrypto.randomUUID()}`;
  }
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** The group a field currently belongs to, if any. */
export function groupIdOfField(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  fieldId: string,
): string | undefined {
  return validColumnGroups(config, fields).find((group) =>
    group.fieldIds.includes(fieldId),
  )?.id;
}

/** Columns in the canonical, group-normalised order. */
function normalizedColumns(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  columns: readonly TableColumnConfig[],
  groups: readonly TableColumnGroup[],
): TableColumnConfig[] {
  return orderColumnsByGroups(columns, groups);
}

/**
 * Moves `fromId` so it sits at `toIndex` in the canonical order.
 *
 * Group membership is untouched; the group projection is re-applied afterwards
 * so members stay contiguous.
 */
export function moveField(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  fromId: string,
  toIndex: number,
): TableViewConfig {
  const resolved = resolveTableColumns(config, fields);
  const from = resolved.findIndex((column) => column.fieldId === fromId);
  if (from < 0) return config;
  const next = [...resolved];
  const [moved] = next.splice(from, 1);
  if (!moved) return config;
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, moved);
  return {
    ...config,
    columns: normalizedColumns(
      config,
      fields,
      next,
      validColumnGroups(config, fields),
    ),
  };
}

/**
 * Puts `fieldId` into `groupId` (or removes it from every group when `null`).
 *
 * The group list is cleaned up: an emptied group disappears, and the columns
 * are re-projected so the new membership reads as one contiguous block.
 */
export function setFieldGroup(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  fieldId: string,
  groupId: string | null,
): TableViewConfig {
  const stripped = validColumnGroups(config, fields).map((group) => ({
    ...group,
    fieldIds: group.fieldIds.filter((entry) => entry !== fieldId),
  }));
  const groups = groupId
    ? stripped.map((group) =>
        group.id === groupId
          ? { ...group, fieldIds: [...group.fieldIds, fieldId] }
          : group,
      )
    : stripped;
  const kept = groups.filter((group) => group.fieldIds.length > 0);
  return {
    ...config,
    columnGroups: kept,
    columns: normalizedColumns(
      config,
      fields,
      resolveTableColumns(config, fields),
      kept,
    ),
  };
}

/**
 * 创建编组: a fresh group containing just this field.
 *
 * The group is returned alongside the next config so the caller can put it
 * straight into rename mode — 创建编组 must land on a named group, and the
 * default name is only a placeholder.
 */
export function createGroupWithField(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  fieldId: string,
): { config: TableViewConfig; group: TableColumnGroup } {
  const existing = validColumnGroups(config, fields);
  const usedNames = new Set(existing.map((group) => group.name));
  let index = existing.length + 1;
  while (usedNames.has(translate("编组 {value1}", { value1: index })))
    index += 1;
  const group: TableColumnGroup = {
    id: createGroupId(),
    name: translate("编组 {value1}", { value1: index }),
    fieldIds: [fieldId],
  };
  const stripped = setFieldGroup(config, fields, fieldId, null);
  const groups = [...validColumnGroups(stripped, fields), group];
  return {
    config: {
      ...stripped,
      columnGroups: groups,
      columns: normalizedColumns(
        stripped,
        fields,
        resolveTableColumns(stripped, fields),
        groups,
      ),
    },
    group,
  };
}

export function renameGroup(
  config: TableViewConfig,
  groupId: string,
  name: string,
): TableViewConfig {
  const trimmed = name.trim();
  if (!trimmed) return config;
  return {
    ...config,
    columnGroups: (config.columnGroups ?? []).map((group) =>
      group.id === groupId ? { ...group, name: trimmed } : group,
    ),
  };
}

/** 解散编组: the members stay, the header goes. */
export function dissolveGroup(
  config: TableViewConfig,
  groupId: string,
): TableViewConfig {
  return {
    ...config,
    columnGroups: (config.columnGroups ?? []).filter(
      (group) => group.id !== groupId,
    ),
  };
}

/**
 * True when a field renders, honouring both visibility stores: the per-column
 * `visible` flag and the `hiddenFieldIds` shortcut.
 */
export function isFieldVisible(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  fieldId: string,
): boolean {
  const column = resolveTableColumns(config, fields).find(
    (entry) => entry.fieldId === fieldId,
  );
  if (!column) return false;
  return column.visible && !(config.hiddenFieldIds ?? []).includes(fieldId);
}

/**
 * Shows / hides a field. Visibility lives in two places on purpose —
 * `columns[].visible` (per column) and `hiddenFieldIds` (the shortcut the
 * header context menu writes) — so both are written to keep them agreeing.
 */
export function setFieldVisible(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  fieldId: string,
  visible: boolean,
): TableViewConfig {
  const columns = resolveTableColumns(config, fields).map((column) =>
    column.fieldId === fieldId ? { ...column, visible } : column,
  );
  const hidden = new Set(config.hiddenFieldIds ?? []);
  if (visible) hidden.delete(fieldId);
  else hidden.add(fieldId);
  return {
    ...config,
    columns,
    hiddenFieldIds: Array.from(hidden),
  };
}

/** Shows every field in a group, or hides them all. */
export function setGroupVisible(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  groupId: string,
  visible: boolean,
): TableViewConfig {
  const group = validColumnGroups(config, fields).find(
    (entry) => entry.id === groupId,
  );
  if (!group) return config;
  return group.fieldIds.reduce(
    (next, fieldId) => setFieldVisible(next, fields, fieldId, visible),
    config,
  );
}

/** 新增字段: appends the field (and its column config) at `index` (default end). */
export function addField(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  field: DatabaseField,
  index?: number,
): TableViewConfig {
  const columns = resolveTableColumns(config, fields);
  const nextColumns: TableColumnConfig[] = [
    ...columns,
    { fieldId: field.id, visible: true },
  ];
  if (index == null) return { ...config, columns: nextColumns };
  const from = nextColumns.findIndex((column) => column.fieldId === field.id);
  const clamped = Math.max(0, Math.min(index, columns.length));
  const moved = [...nextColumns];
  const [entry] = moved.splice(from, 1);
  if (entry) moved.splice(clamped, 0, entry);
  return { ...config, columns: moved };
}

/**
 * Applies the whole field-level edit in one step.
 *
 * The schema half comes from `editFieldSchema` (shared with the card views'
 * 卡片配置, so a field added there and a field added here behave identically);
 * this function adds the table's own half — a new field's column config.
 */
export function applyFieldEdit(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  rows: readonly DataRow[],
  field: DatabaseField,
  seed?: { fieldId: string; cell: DatabaseCell },
): { config: TableViewConfig; fields: DatabaseField[]; rows?: DataRow[] } {
  const schema = editFieldSchema(fields, rows, field, seed);
  return {
    config: schema.isNew ? addField(config, fields, field) : config,
    fields: schema.fields,
    ...(schema.rows ? { rows: schema.rows } : {}),
  };
}

/**
 * 删除字段: removes the field, its column config and its group membership, and
 * drops every cell that pointed at it (the domain rejects orphan field keys).
 */
export function removeField(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  rows: readonly DataRow[],
  fieldId: string,
): { config: TableViewConfig; fields: DatabaseField[]; rows: DataRow[] } {
  const schema = deleteFieldSchema(fields, rows, fieldId);
  const groups = (config.columnGroups ?? [])
    .map((group) => ({
      ...group,
      fieldIds: group.fieldIds.filter((entry) => entry !== fieldId),
    }))
    .filter((group) => group.fieldIds.length > 0);
  const columns = resolveTableColumns(config, fields).filter(
    (column) => column.fieldId !== fieldId,
  );
  return {
    config: {
      ...config,
      columns,
      columnGroups: groups,
      hiddenFieldIds: (config.hiddenFieldIds ?? []).filter(
        (entry) => entry !== fieldId,
      ),
    },
    fields: schema.fields,
    rows: schema.rows,
  };
}

/** A field row as the 字段配置 menu renders it. */
export interface FieldMenuRow {
  kind: "field";
  field: DatabaseField;
  group?: TableColumnGroup;
  visible: boolean;
}

/** A group header row (the menu folds its members underneath). */
export interface GroupMenuRow {
  kind: "group";
  group: TableColumnGroup;
  fields: DatabaseField[];
  visible: boolean;
}

export type FieldMenuEntry = FieldMenuRow | GroupMenuRow;

/**
 * The 字段配置 list, in config order: group headers followed by their members,
 * ungrouped fields as standalone rows. Groups never repeat their members.
 */
export function buildFieldMenuEntries(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
): FieldMenuEntry[] {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const groups = validColumnGroups(config, fields);
  const groupIndexOf = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const fieldId of group.fieldIds) {
      if (!groupIndexOf.has(fieldId)) groupIndexOf.set(fieldId, index);
    }
  });

  const resolved = resolveTableColumns(config, fields);
  const hidden = new Set(config.hiddenFieldIds ?? []);
  const isVisible = (fieldId: string) => {
    const column = resolved.find((entry) => entry.fieldId === fieldId);
    return column ? column.visible && !hidden.has(fieldId) : false;
  };

  const entries: FieldMenuEntry[] = [];
  const started = new Set<number>();
  for (const column of resolved) {
    const field = byId.get(column.fieldId);
    if (!field) continue;
    const groupIndex = groupIndexOf.get(field.id);
    if (groupIndex === undefined) {
      entries.push({ kind: "field", field, visible: isVisible(field.id) });
      continue;
    }
    if (started.has(groupIndex)) {
      const header = entries.find(
        (entry): entry is GroupMenuRow =>
          entry.kind === "group" && entry.group.id === groups[groupIndex]!.id,
      );
      header?.fields.push(field);
      if (header && isVisible(field.id)) header.visible = true;
      continue;
    }
    started.add(groupIndex);
    entries.push({
      kind: "group",
      group: groups[groupIndex]!,
      fields: [field],
      visible: isVisible(field.id),
    });
  }
  return entries;
}
