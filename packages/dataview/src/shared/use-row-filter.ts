// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMemo } from "react";
import type {
  DatabaseField,
  DataRow,
  DataViewSource,
} from "@workspace/interfaces";

import { sortValue } from "../source/cell-resolver";

/**
 * The flat, serializable row filter the root applies before handing a source
 * to a renderer.
 *
 * It is intentionally narrower than a full query builder: field-level condition
 * filtering is a cross-view concern (README §8), while rich per-column
 * filtering belongs to the renderer that owns that column's UI.
 */
export interface RowFilterCondition {
  fieldId: string;
  operator: "contains" | "equals" | "notEmpty" | "empty" | "gt" | "lt";
  value?: string | number;
}

/** True when `row` satisfies every condition. */
export function rowMatchesConditions(
  row: DataRow,
  conditions: readonly RowFilterCondition[],
  fields: readonly DatabaseField[] = [],
): boolean {
  return conditions.every((condition) => {
    const field = fields.find(
      (candidate) => candidate.id === condition.fieldId,
    );
    const value = sortValue(row.cells[condition.fieldId], field);
    switch (condition.operator) {
      case "contains":
        return String(value)
          .toLocaleLowerCase()
          .includes(String(condition.value ?? "").toLocaleLowerCase());
      case "equals":
        return String(value) === String(condition.value ?? "");
      case "notEmpty":
        return String(value) !== "";
      case "empty":
        return String(value) === "";
      case "gt":
        return Number(value) > Number(condition.value ?? 0);
      case "lt":
        return Number(value) < Number(condition.value ?? 0);
      default:
        return true;
    }
  });
}

/** Applies conditions to a source, returning a new source (rows replaced). */
export function filterDataSource(
  source: DataViewSource,
  conditions: readonly RowFilterCondition[] | undefined,
): DataViewSource {
  if (!conditions || conditions.length === 0) return source;

  const keptIndexes: number[] = [];
  const rows = source.rows.filter((row, index) => {
    const keep = rowMatchesConditions(row, conditions, source.fields);
    if (keep) keptIndexes.push(index);
    return keep;
  });

  return {
    ...source,
    rows,
    // Keep the node-id list index-aligned with the filtered rows.
    nodeIds: source.nodeIds
      ? keptIndexes.map((index) => source.nodeIds?.[index] ?? "")
      : undefined,
  };
}

/** Memoized {@link filterDataSource}. */
export function useRowFilteredSource(
  source: DataViewSource,
  conditions?: readonly RowFilterCondition[],
): DataViewSource {
  return useMemo(
    () => filterDataSource(source, conditions),
    [source, conditions],
  );
}
