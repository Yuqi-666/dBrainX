// SPDX-License-Identifier: AGPL-3.0-only

import { getLocale } from "@workspace/ui/lib/i18n/runtime";
/**
 * The single conversion hub between `DatabaseCell` and whatever shape a view
 * needs (label, scalar, date, number, color, node reference, sort key).
 *
 * Both host kinds funnel through here: database cells come straight from the
 * node's table, collection cells are projections of graph node attributes.
 * Views therefore never switch on `DatabaseFieldType` themselves.
 *
 * See `docs/dataview/README.md` §4.3.
 */
import type {
  DatabaseCell,
  DatabaseField,
  DatabaseFieldOption,
  NodeId,
} from "@workspace/interfaces";

/** Placeholder shown for an empty cell unless a view config overrides it. */
export const DEFAULT_EMPTY_TEXT = "—";

/** Resolves the field for a cell, tolerating a field deleted mid-session. */
export function findField(
  fields: readonly DatabaseField[],
  fieldId: string | undefined,
): DatabaseField | undefined {
  if (!fieldId) return undefined;
  return fields.find((field) => field.id === fieldId);
}

/** The declared option behind a `select` / `multiSelect` value. */
export function findOption(
  field: DatabaseField | undefined,
  optionId: string,
): DatabaseFieldOption | undefined {
  return field?.options?.find((option) => option.id === optionId);
}

/** `select` → `[optionId]`, `multiSelect` → `optionIds`, otherwise `[]`. */
export function toOptionIds(cell: DatabaseCell | undefined): string[] {
  if (!cell) return [];
  if (cell.type === "select") return cell.optionId ? [cell.optionId] : [];
  if (cell.type === "multiSelect") return cell.optionIds ?? [];
  return [];
}

/** `relation` → `NodeId[]`, otherwise `[]`. */
export function toNodeIds(cell: DatabaseCell | undefined): NodeId[] {
  if (cell?.type === "relation") return cell.nodeIds ?? [];
  return [];
}

/** `YYYY-MM-DD`, i.e. a calendar day rather than an instant. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const dateOnly = DATE_ONLY.exec(trimmed);
  // A date-only cell is a *calendar day*: `new Date("2026-05-20")` is UTC
  // midnight, so anywhere west of Greenwich it renders as 05-19 and a calendar
  // event lands on the wrong square. Build it from local components instead.
  // A full ISO timestamp keeps its instant and is read back in local time.
  const date = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      )
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `date` → `Date`, otherwise `null`. Invalid input degrades to `null`. */
export function toDate(cell: DatabaseCell | undefined): Date | null {
  if (cell?.type === "date") return parseDate(cell.date);
  return null;
}

/** `number` → `number`, `date` → epoch ms, `checkbox` → 0/1, otherwise `null`. */
export function toNumber(cell: DatabaseCell | undefined): number | null {
  if (!cell) return null;
  switch (cell.type) {
    case "number":
      return cell.number ?? null;
    case "checkbox":
      return cell.checked ? 1 : 0;
    case "date": {
      const date = parseDate(cell.date);
      return date ? date.getTime() : null;
    }
    default:
      return null;
  }
}

/**
 * The user-facing text for a cell.
 *
 * `select` / `multiSelect` resolve option names (falling back to the raw id so
 * a stale value is still visible); `relation` resolves node titles through the
 * caller-supplied lookup, falling back to the id. Empty values yield `""` —
 * views decide on their own placeholder (usually {@link DEFAULT_EMPTY_TEXT}).
 */
export function displayText(
  cell: DatabaseCell | undefined,
  field: DatabaseField | undefined,
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined,
): string {
  if (!cell) return "";
  switch (cell.type) {
    case "text":
      return cell.text ?? "";
    case "number":
      return cell.number == null ? "" : String(cell.number);
    case "select": {
      if (!cell.optionId) return "";
      return findOption(field, cell.optionId)?.name ?? cell.optionId;
    }
    case "multiSelect": {
      return (cell.optionIds ?? [])
        .map((optionId) => findOption(field, optionId)?.name ?? optionId)
        .join(", ");
    }
    case "date": {
      const date = parseDate(cell.date);
      // Date-only in the editor; render in the viewer's locale.
      return date
        ? field?.includeTime
          ? date.toLocaleString(getLocale(), {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : date.toLocaleDateString(getLocale())
        : "";
    }
    case "checkbox":
      return cell.checked ? "✓" : "";
    case "url":
      return cell.url ?? "";
    case "relation":
      return (cell.nodeIds ?? [])
        .map((nodeId) => resolveNodeTitle?.(nodeId) ?? nodeId)
        .join(", ");
  }
}

/**
 * The raw scalar behind a cell, for aggregation (chart measures, gantt
 * progress, sorting helpers). Multi-valued cells flatten to a comma-joined
 * string so callers always get a scalar.
 */
export function rawScalar(
  cell: DatabaseCell | undefined,
  field: DatabaseField | undefined,
): string | number | boolean | null {
  if (!cell) return null;
  switch (cell.type) {
    case "text":
      return cell.text ?? "";
    case "number":
      return cell.number ?? null;
    case "select":
      return cell.optionId;
    case "multiSelect":
      return displayText(cell, field);
    case "date":
      return cell.date;
    case "checkbox":
      return cell.checked;
    case "url":
      return cell.url;
    case "relation":
      return (cell.nodeIds ?? []).join(",");
  }
}

/**
 * A key that orders cells of one field consistently.
 *
 * Numbers compare numerically, dates and ISO strings compare lexicographically
 * (chronologically), and every other type compares by display text so the
 * ordering matches what the user sees.
 */
export function sortValue(
  cell: DatabaseCell | undefined,
  field: DatabaseField | undefined,
): string | number {
  if (!cell) return "";
  switch (cell.type) {
    case "number":
      return cell.number ?? 0;
    case "checkbox":
      return cell.checked ? 1 : 0;
    case "date":
      return cell.date ?? "";
    default:
      return displayText(cell, field).toLocaleLowerCase();
  }
}

/** Stable, dependency-free hue from an arbitrary key. */
function hashHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360;
  }
  return hash;
}

/**
 * A CSS color for a cell, used by kanban lanes, gallery badges, gantt bars and
 * calendar events. Declared option colors win; anything else falls back to a
 * deterministic hue so the same value always renders the same color.
 */
export function toColor(
  cell: DatabaseCell | undefined,
  field: DatabaseField | undefined,
): string | null {
  const [optionId] = toOptionIds(cell);
  if (!optionId) return null;
  const declared = findOption(field, optionId)?.color;
  if (declared) return declared;
  return `hsl(${hashHue(`${field?.id ?? ""}:${optionId}`)} 65% 55%)`;
}

/**
 * The namespace the resolver is documented under. Individual functions are
 * also exported separately so tree-shaking works.
 */
export const CellResolver = {
  findField,
  findOption,
  displayText,
  rawScalar,
  toDate,
  toNumber,
  toColor,
  toNodeIds,
  toOptionIds,
  sortValue,
} as const;
