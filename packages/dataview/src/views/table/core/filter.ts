// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * The table view's filter conditions (筛选).
 *
 * The 筛选 menu is a list of conditions — field + operator + value — instead of
 * the old "one quick filter per column" record. `TableViewConfig.filterState` is
 * persisted as a loose `Record<string, unknown>` (node content, validated by the
 * domain only as an object), so this module owns both the runtime shape and the
 * defensive reader that turns the persisted blob back into it — including the
 * legacy `{ [fieldId]: { operator, value } }` shape, which is migrated on read.
 *
 * See `docs/dataview/table.md` §5.4.
 */
import type {
  DatabaseField,
  TableConditionOperator,
  TableFilterCondition,
} from "@workspace/interfaces";

import { type TableRecord } from "./schema";

export type TableFilterOperator = TableConditionOperator;

export const TABLE_FILTER_OPERATORS: readonly TableFilterOperator[] = [
  "contains",
  "equals",
  "empty",
  "notEmpty",
];

export const TABLE_FILTER_OPERATOR_LABELS: Record<TableFilterOperator, string> =
  {
    get contains() {
      return translate("包含");
    },
    get equals() {
      return translate("等于");
    },
    get empty() {
      return translate("为空");
    },
    get notEmpty() {
      return translate("不为空");
    },
  };

export type { TableFilterCondition };

/** The whole filter state: an ordered list of ANDed conditions. */
export type TableFilterState = TableFilterCondition[];

/** A fresh condition id (used as the React key and for targeted removal). */
export function createFilterConditionId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `flt_${globalCrypto.randomUUID()}`;
  }
  return `flt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isOperator(value: unknown): value is TableFilterOperator {
  return TABLE_FILTER_OPERATORS.includes(value as TableFilterOperator);
}

/** Reads one persisted condition, or `null` when it is not usable. */
function readCondition(
  raw: unknown,
  fieldId: string | undefined,
  index: number,
): TableFilterCondition | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as {
    fieldId?: unknown;
    operator?: unknown;
    value?: unknown;
  };
  const resolvedFieldId =
    typeof record.fieldId === "string" ? record.fieldId : fieldId;
  // `""` is a *usable* field id here: it is the row 添加条件 just created, whose
  // 字段 is still unchosen. Rejecting it made the new row vanish on the next
  // read — the click looked like it did nothing at all. Only a *missing* field
  // id (a legacy record keyed by field) is unusable.
  if (resolvedFieldId === undefined || !isOperator(record.operator)) {
    return null;
  }
  return {
    id:
      typeof (raw as { id?: unknown }).id === "string"
        ? (raw as { id: string }).id
        : `flt_legacy_${index}_${resolvedFieldId}`,
    fieldId: resolvedFieldId,
    operator: record.operator,
    value: typeof record.value === "string" ? record.value : undefined,
  };
}

/**
 * Reads `config.filterState`.
 *
 * Accepts the current condition list and the legacy per-field record, and drops
 * anything that is not a usable condition — so an old persisted view keeps
 * working instead of rendering an empty 筛选 menu.
 */
export function readFilterState(raw: unknown): TableFilterState {
  if (Array.isArray(raw)) {
    return raw
      .map((entry, index) => readCondition(entry, undefined, index))
      .filter((entry): entry is TableFilterCondition => entry !== null);
  }
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw)
    .map(([fieldId, entry], index) => readCondition(entry, fieldId, index))
    .filter((entry): entry is TableFilterCondition => entry !== null);
}

/** Drops conditions whose field no longer exists (self-healing). */
export function sanitizeFilterState(
  state: TableFilterState,
  fields: readonly DatabaseField[],
): TableFilterState {
  const known = new Set(fields.map((field) => field.id));
  // A not-yet-configured row (`fieldId: ""`, the state 添加条件 creates) is kept:
  // dropping it would make the row vanish from the menu the moment it is added.
  // A row pointing at a *deleted* field is dropped instead (self-healing).
  return state.filter(
    (condition) => condition.fieldId === "" || known.has(condition.fieldId),
  );
}

/** True when a condition actually narrows the result set. */
export function isConditionActive(condition: TableFilterCondition): boolean {
  if (!condition.fieldId) return false;
  if (condition.operator === "empty" || condition.operator === "notEmpty") {
    return true;
  }
  return Boolean(condition.value?.trim());
}

/** Number of conditions that narrow the result set (the toolbar badge). */
export function activeFilterCount(state: TableFilterState): number {
  return state.filter(isConditionActive).length;
}

/** Applies one operator to a record's display text. */
export function valueMatchesCondition(
  text: string,
  operator: TableFilterOperator,
  value: string | undefined,
): boolean {
  switch (operator) {
    case "empty":
      return text.trim() === "";
    case "notEmpty":
      return text.trim() !== "";
    case "equals":
      return text === (value ?? "");
    case "contains":
    default:
      return text
        .toLocaleLowerCase()
        .includes((value ?? "").trim().toLocaleLowerCase());
  }
}

/**
 * Applies every active condition to the records, preserving order.
 *
 * `fields` scopes evaluation to live fields: a condition left over from a
 * deleted field is inert rather than matching everything.
 */
export function applyTableFilters(
  records: readonly TableRecord[],
  filters: TableFilterState,
  fields: readonly DatabaseField[],
): TableRecord[] {
  const known = new Set(fields.map((field) => field.id));
  const active = filters.filter(
    (condition) => known.has(condition.fieldId) && isConditionActive(condition),
  );
  if (active.length === 0) return records as TableRecord[];
  return records.filter((record) =>
    active.every((condition) => {
      const raw = record[condition.fieldId];
      const text = raw === null || raw === undefined ? "" : String(raw);
      return valueMatchesCondition(text, condition.operator, condition.value);
    }),
  );
}

/**
 * The operators a field offers, derived from its type: enum-ish values compare
 * by equality, everything else by substring.
 */
export function filterOperatorsForField(
  field: DatabaseField,
): TableFilterOperator[] {
  switch (field.type) {
    case "select":
    case "multiSelect":
    case "checkbox":
    case "date":
      return ["equals", "contains", "notEmpty", "empty"];
    default:
      return ["contains", "equals", "notEmpty", "empty"];
  }
}

/** Removes one condition (used by its `×` and by "清除全部"). */
export function removeFilterCondition(
  state: TableFilterState,
  conditionId: string,
): TableFilterState {
  return state.filter((condition) => condition.id !== conditionId);
}
