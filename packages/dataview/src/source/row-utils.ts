// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Row plumbing shared by every view that can mint or empty a row.
 *
 * These are pure data helpers with no React and no third-party library, so they
 * belong next to the other host-independent data conversions (`cell-resolver`,
 * `field-utils`) rather than inside one view's `core/`. The table re-exports
 * them from `views/table/core/schema.ts` for its own call sites; the kanban
 * builds a new card's row with them.
 *
 * See `docs/dataview/README.md` §4.
 */
import type {
  DatabaseCell,
  DatabaseField,
  DataRow,
} from "@workspace/interfaces";

/** A fresh row id for an inserted row. */
export function createDataRowId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `row_${globalCrypto.randomUUID()}`;
  }
  return `row_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh field id for an added column / a field created in the record editor. */
export function createDatabaseFieldId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `fld_${globalCrypto.randomUUID()}`;
  }
  return `fld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh option id (a new 单选/多选 option the user just typed). */
export function createDatabaseFieldOptionId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `opt_${globalCrypto.randomUUID()}`;
  }
  return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The empty cell a field carries when it has no value.
 *
 * Every cell must agree with its field's type: `DatabaseContent` rejects a cell
 * whose `type` disagrees, so a view that creates a row fills it from here.
 */
export function emptyCellForField(field: DatabaseField): DatabaseCell {
  switch (field.type) {
    case "number":
      return { type: "number", number: null };
    case "select":
      return { type: "select", optionId: null };
    case "multiSelect":
      return { type: "multiSelect", optionIds: [] };
    case "date":
      return { type: "date", date: null };
    case "checkbox":
      return { type: "checkbox", checked: false };
    case "url":
      return { type: "url", url: null };
    case "relation":
      return { type: "relation", nodeIds: [] };
    case "text":
    default:
      return { type: "text", text: "" };
  }
}

/** A fresh row with every field emptied, optionally overriding one cell. */
export function createEmptyDataRow(
  fields: readonly DatabaseField[],
  seed?: { fieldId: string; cell: DatabaseCell },
): DataRow {
  const cells: Record<string, DatabaseCell> = {};
  for (const field of fields) cells[field.id] = emptyCellForField(field);
  if (seed) cells[seed.fieldId] = seed.cell;
  return { id: createDataRowId(), cells };
}

/**
 * Keeps a cell only when it still fits its field.
 *
 * A retyped field, a shrunk option list or a deleted field must not leave a
 * cell the domain rejects (`DatabaseContent` throws on a cell whose `type`
 * disagrees with its field, on an orphan field key, and on an unknown option
 * id), so everything that no longer fits is dropped here.
 */
function coerceCellToField(
  cell: DatabaseCell,
  field: DatabaseField,
): DatabaseCell | undefined {
  if (!cell || cell.type !== field.type) return undefined;
  if (cell.type === "select") {
    if (cell.optionId === null) return cell;
    return field.options?.some((option) => option.id === cell.optionId)
      ? cell
      : undefined;
  }
  if (cell.type === "multiSelect") {
    const optionIds = cell.optionIds.filter((optionId) =>
      field.options?.some((option) => option.id === optionId),
    );
    return optionIds.length === cell.optionIds.length
      ? cell
      : { type: "multiSelect", optionIds };
  }
  return cell;
}

/**
 * Reconciles every row against a new field list.
 *
 * Drops the cells of deleted fields and any cell that no longer matches its
 * field, then seeds `seed` into the rows that have no value yet (the field
 * editor's 默认值). Returns the *same* array when nothing changed, so the caller
 * can tell whether a row rewrite needs to accompany the schema write.
 *
 * Shared by the table's 字段配置 and the record editor, so a field deleted in
 * either place leaves the same cells behind.
 */
export function reconcileRowsForFields(
  rows: readonly DataRow[],
  nextFields: readonly DatabaseField[],
  seed?: { fieldId: string; cell: DatabaseCell },
): { rows: DataRow[]; changed: boolean } {
  const fieldById = new Map(nextFields.map((field) => [field.id, field]));
  let changed = false;

  const next = rows.map((row) => {
    let rowChanged = false;
    const cells: Record<string, DatabaseCell> = {};
    for (const [fieldId, cell] of Object.entries(row.cells ?? {})) {
      const field = fieldById.get(fieldId);
      if (!field) {
        rowChanged = true;
        continue;
      }
      const coerced = coerceCellToField(cell, field);
      if (!coerced) {
        rowChanged = true;
        continue;
      }
      cells[fieldId] = coerced;
    }
    if (seed && !cells[seed.fieldId] && fieldById.has(seed.fieldId)) {
      cells[seed.fieldId] = seed.cell;
      rowChanged = true;
    }
    if (!rowChanged) return row as DataRow;
    changed = true;
    return { ...row, cells };
  });

  return { rows: next, changed };
}

/**
 * The **schema half** of a field edit — shared by every 字段配置 surface.
 *
 * `field` may be new or an edited version of an existing one; `seed` is the
 * editor's 默认值. `rows` comes back only when cells actually had to change, so
 * the caller can send the leanest possible content write.
 *
 * Adding a field to a source that has **no rows at all** also mints one empty
 * row (carrying the 默认值 when there is one): an empty table with a schema but
 * nothing to type into reads as "the table did not appear", because VTable can
 * only draw headers. Callers that own a per-field config (the table's columns,
 * a card's `cardFields`) use `isNew` to append that entry.
 */
export function editFieldSchema(
  fields: readonly DatabaseField[],
  rows: readonly DataRow[],
  field: DatabaseField,
  seed?: { fieldId: string; cell: DatabaseCell },
): { fields: DatabaseField[]; rows?: DataRow[]; isNew: boolean } {
  const existingIndex = fields.findIndex((entry) => entry.id === field.id);
  const nextFields =
    existingIndex >= 0
      ? fields.map((entry) => (entry.id === field.id ? field : entry))
      : [...fields, field];

  const isNew = existingIndex < 0;
  const mintRow = isNew && rows.length === 0;
  const baseRows: DataRow[] = mintRow
    ? [
        {
          id: createDataRowId(),
          cells: seed ? { [seed.fieldId]: seed.cell } : {},
        },
      ]
    : [...rows];

  const reconciled = reconcileRowsForFields(baseRows, nextFields, seed);
  return {
    fields: nextFields,
    isNew,
    // A minted row carries no cells, so `reconcileRowsForFields` reports no
    // change for it — the row itself is the change.
    ...(reconciled.changed || mintRow ? { rows: reconciled.rows } : {}),
  };
}

/**
 * The schema half of 删除字段: removes the field and drops every cell that
 * pointed at it (the domain rejects orphan field keys).
 */
export function deleteFieldSchema(
  fields: readonly DatabaseField[],
  rows: readonly DataRow[],
  fieldId: string,
): { fields: DatabaseField[]; rows: DataRow[] } {
  const nextFields = fields.filter((field) => field.id !== fieldId);
  const reconciled = reconcileRowsForFields(rows, nextFields);
  return { fields: nextFields, rows: reconciled.rows };
}
