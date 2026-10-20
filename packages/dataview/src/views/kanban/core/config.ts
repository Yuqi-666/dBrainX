// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Kanban config resolution — the self-healing layer between a persisted
 * `KanbanViewConfig` and the concrete fields a board is built from.
 *
 * A view config outlives the schema it was written against: a field can be
 * deleted, retyped (single → multi select) or renamed between two openings, so
 * nothing here trusts the persisted ids. Every resolver answers "what is the
 * *live* thing this id means" and degrades to `null`/`""` instead of throwing
 * (README §5.1); the renderer turns that into the missing-field guidance.
 *
 * What a **card** shows (title / cover / card fields / 展示模式) is not here: it
 * is shared with the gallery and lives in `shared/card-ops.ts`. This module is
 * the board's own half — lanes, their order, and the cells a drag writes.
 *
 * Pure module: no React, no third-party library.
 */
import type {
  DatabaseCell,
  DatabaseField,
  DatabaseFieldOption,
  KanbanViewConfig,
  TableCondition,
} from "@workspace/interfaces";

import { resolveOptionColor } from "../../../shared/field-meta";

/**
 * The card order, as the same condition list the table's 排序 menu writes.
 *
 * Self-healing, like every other resolver here: a level whose field is gone is
 * dropped, but a level the user has not given a field yet is kept so its row
 * stays visible in the menu. A view saved before the list existed carries the
 * legacy single-level `sortBy`, which reads as a one-level list.
 */
export function resolveKanbanSort(
  fields: readonly DatabaseField[],
  config: Pick<KanbanViewConfig, "sortState" | "sortBy">,
): TableCondition[] {
  const stored =
    config.sortState && config.sortState.length > 0
      ? config.sortState
      : config.sortBy
        ? [config.sortBy]
        : [];
  const known = new Set(fields.map((field) => field.id));
  return stored.filter(
    (level) => Boolean(level) && (!level.fieldId || known.has(level.fieldId)),
  );
}

/** Grouping needs a field that carries an option list (单选 / 多选). */
export function isGroupableField(
  field: Pick<DatabaseField, "type"> | undefined,
): boolean {
  return field?.type === "select" || field?.type === "multiSelect";
}

/** Every field a kanban may group by, in schema order. */
export function groupableFields(
  fields: readonly DatabaseField[],
): DatabaseField[] {
  return fields.filter(isGroupableField);
}

/**
 * The live group field for `groupByField`.
 *
 * `null` when the id is empty (nothing chosen yet) or no longer names a
 * select/multiSelect field — the two cases the guidance UI distinguishes by
 * looking at {@link groupableFields}: "pick a field" vs "this table has none".
 */
export function resolveGroupField(
  fields: readonly DatabaseField[],
  groupByField: string | undefined,
): DatabaseField | null {
  const field = fields.find((candidate) => candidate.id === groupByField);
  return isGroupableField(field) ? (field ?? null) : null;
}

/** `true` when the group field holds a set of options rather than one. */
export function isMultiValueGroup(
  field: DatabaseField | null | undefined,
): boolean {
  return field?.type === "multiSelect";
}

/**
 * Applies `config.laneOrder` to a field's options.
 *
 * Options the order does not know about (a newly added one, or a view whose
 * order was written before the field grew) keep their schema position after the
 * ordered ones, so the board never hides a lane.
 */
export function orderLaneOptions(
  options: readonly DatabaseFieldOption[],
  laneOrder: readonly string[] | undefined,
): DatabaseFieldOption[] {
  if (!laneOrder || laneOrder.length === 0) return [...options];
  const byId = new Map(options.map((option) => [option.id, option]));
  const ordered: DatabaseFieldOption[] = [];
  const seen = new Set<string>();
  for (const optionId of laneOrder) {
    const option = byId.get(optionId);
    if (option && !seen.has(option.id)) {
      ordered.push(option);
      seen.add(option.id);
    }
  }
  for (const option of options) {
    if (!seen.has(option.id)) ordered.push(option);
  }
  return ordered;
}

/**
 * The colour an option renders with: its declared colour, else the palette
 * entry for its position — the same rule the table's capsules use, so one
 * option has one colour in every view.
 */
export function optionColor(
  field: DatabaseField | null | undefined,
  optionId: string,
): string {
  const options = field?.options ?? [];
  const index = options.findIndex((option) => option.id === optionId);
  if (index >= 0) return resolveOptionColor(options[index]!, index);
  // A stale cell value (the option is gone) still needs a stable swatch.
  return resolveOptionColor({ id: optionId, name: optionId }, options.length);
}

/**
 * The cell a card drag writes into the group field.
 *
 * `laneId === KANBAN_UNASSIGNED_LANE_ID` clears the selection, which is what
 * dragging a card into 未分组 means; every other lane id *is* the target
 * option id. `multiSelect` boards never reach here — their drag is disabled,
 * because "which of the other options does this remove?" has no single answer
 * (kanban.md §8).
 */
export function cellForLane(
  field: DatabaseField,
  laneId: string,
  unassignedLaneId: string,
): DatabaseCell {
  const optionId = laneId === unassignedLaneId ? null : laneId;
  if (field.type === "multiSelect") {
    return { type: "multiSelect", optionIds: optionId ? [optionId] : [] };
  }
  return { type: "select", optionId };
}

/**
 * Renames / recolours one option (the lane header's 编辑选项).
 *
 * Only `name` and `color` are patchable: both are inert with respect to the
 * rows (cells store the option *id*), so the caller can write the returned
 * field list through `onFieldsChange(fields)` without rewriting a single cell.
 */
export function patchFieldOption(
  fields: readonly DatabaseField[],
  fieldId: string,
  optionId: string,
  patch: Partial<Pick<DatabaseFieldOption, "name" | "color">>,
): DatabaseField[] {
  return fields.map((field) => {
    if (field.id !== fieldId || !field.options) return field;
    return {
      ...field,
      options: field.options.map((option) =>
        option.id === optionId ? { ...option, ...patch } : option,
      ),
    };
  });
}

/** A config with the given patch applied (config writes always go whole). */
export function withKanbanConfig(
  config: KanbanViewConfig,
  patch: Partial<KanbanViewConfig>,
): KanbanViewConfig {
  return { ...config, ...patch };
}
