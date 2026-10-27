// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The gantt's data-transformation layer: `rows` + a field mapping → the flat
 * record list VTable-Gantt draws, and a drag → the date/progress cells it writes
 * back (gantt.md §3).
 *
 * Everything here is pure — the records are plain objects keyed by the reserved
 * names below, **not** by live field ids. That is deliberate:
 *
 * 1. the timeline is one flat record list (`Tasks_Separate`), so a 分组 becomes
 *    a synthetic header row that owns the group's span — VTable-Gantt's own
 *    `groupBy` is declared but unimplemented in 1.26.8, and its nested
 *    `children` model silently disables the task list's tree (gantt.md §0);
 * 2. the record is a **view model**: it may hold values no field has (a group
 *    span, a title fallback), and a record field can never be mistaken for a
 *    column when the schema changes underneath it;
 * 3. writing back goes through `resolveStartField` / `resolveEndField` against the
 *    *live* schema, so a deleted field cannot produce a write to a dead id.
 *
 * Two date rules carry the view, and they are the opposite of the calendar's:
 * VTable-Gantt's end date is **inclusive** (`taskDays = end - start + 1`), so a
 * `date` cell maps onto a task's end directly — there is no ±1 day conversion
 * anywhere in this view.
 *
 * Pure module: no React, no third-party library (the record's `type: "project"`
 * is the string VTable-Gantt's `TaskType.PROJECT` equals at runtime).
 */
import type {
  DatabaseCell,
  DatabaseField,
  DataRow,
  DataViewSource,
  GanttViewConfig,
  NodeId,
} from "@workspace/interfaces";

import {
  displayText,
  toColor,
  toDate,
  toNumber,
} from "../../../source/cell-resolver";
import {
  GANTT_FIXED,
  resolveEndField,
  resolveGroupField,
  resolveProgressField,
  resolveStartField,
  resolveTitleField,
  resolveTooltipFields,
} from "./config";

// The reserved record keys. `taskKeyField` is the first one, so VTable-Gantt
// identifies a task by its row id and a group header by a synthetic id.
export const GANTT_ROW_ID = "__ganttId";
export const GANTT_TITLE = "__ganttTitle";
export const GANTT_START = "__ganttStart";
export const GANTT_END = "__ganttEnd";
export const GANTT_PROGRESS = "__ganttProgress";
export const GANTT_GROUP_KEY = "__ganttGroupKey";
export const GANTT_GROUP_LABEL = "__ganttGroupLabel";
export const GANTT_GROUP_COUNT = "__ganttGroupCount";

/** The group key of a row whose group cell is empty. */
export const GANTT_UNGROUPED_KEY = "__ganttUngrouped";

/**
 * One record of the timeline.
 *
 * A task row and a 分组 header row are the same shape; the header is the one
 * with `type: "project"` (which is what makes VTable-Gantt style it with
 * `taskBar.projectStyle`, skip its progress handle, and refuse to drag it).
 */
export interface GanttRecord {
  [GANTT_ROW_ID]: string;
  [GANTT_TITLE]: string;
  [GANTT_START]: string;
  [GANTT_END]?: string;
  /** 0–100 — VTable-Gantt's own progress scale (the field is read as 0–1). */
  [GANTT_PROGRESS]?: number;
  [GANTT_GROUP_KEY]?: string;
  /** Group header rows only: the label without the arrow / count decoration. */
  [GANTT_GROUP_LABEL]?: string;
  [GANTT_GROUP_COUNT]?: number;
  /** VTable-Gantt's `TaskType.PROJECT` marker. */
  type?: "project";
}

/** One `字段：值` line of the hover readout. */
export interface GanttTaskDetail {
  fieldId: string;
  name: string;
  text: string;
  /** Set for 单选/多选 so the readout can show the option's own colour. */
  color?: string;
}

/** What the hover readout shows for one task / group row. */
export interface GanttTaskReadout {
  rowId: string;
  title: string;
  /** `2026-05-20` or `2026-05-20 → 2026-05-22`. */
  dateText: string;
  /** `40%`, when the record carries a progress. */
  progressText?: string;
  /** A group header row: how many tasks the group holds. */
  groupCount?: number;
  details: GanttTaskDetail[];
}

// —— date / progress conversion ——————————————————————————————————————————

/** The `YYYY-MM-DD` day a date lives on, in local time. */
export function toISODate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The local-midnight `Date` an ISO day names (never a UTC instant). */
export function fromISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The cell a date writes into a `date` field. `null` clears it. */
export function dateCell(date: Date | null): DatabaseCell {
  return { type: "date", date: date ? toISODate(date) : null };
}

/**
 * A `number` cell's value read as a 0–1 progress.
 *
 * The field holds a fraction (gantt.md §3.1) while VTable-Gantt draws
 * percentages, and out-of-range input is clamped rather than scaled — a `2` is
 * "finished", not "200%".
 */
export function progressPercent(cell: DatabaseCell | undefined): number {
  return clamp01(toNumber(cell) ?? 0) * 100;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// —— rows → records ————————————————————————————————————————————————————

export interface RowsToGanttRecordsOptions {
  /** The group keys the user has collapsed (their tasks are omitted). */
  collapsed?: ReadonlySet<string>;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
}

/**
 * Projects every row with a usable start date onto a timeline record.
 *
 * A row whose start cell is empty (or unparseable) is skipped rather than pinned
 * to today — a gantt that invents dates is worse than one that omits rows. A row
 * with no end date (or no end field) is a single day: the bar still has to have a
 * span, so the end record field mirrors the start.
 */
export function rowsToGanttRecords(
  source: DataViewSource,
  config: GanttViewConfig,
  options: RowsToGanttRecordsOptions = {},
): GanttRecord[] {
  const startField = resolveStartField(source.fields, config.startField);
  if (!startField) return [];

  const endField = resolveEndField(
    source.fields,
    config.endField,
    startField.id,
  );
  const titleField = resolveTitleField(source.fields, config.titleField);
  const progressField = resolveProgressField(
    source.fields,
    config.progressField,
  );
  const groupField = resolveGroupField(source.fields, config.groupByField);

  const groups = new Map<string, { label: string; records: GanttRecord[] }>();
  const tasks: GanttRecord[] = [];

  for (const row of source.rows) {
    const start = toDate(row.cells[startField.id]);
    if (!start) continue;

    const rawEnd = endField ? toDate(row.cells[endField.id]) : null;
    // An end before the start is not a span; fall back to a single day.
    const end = rawEnd && rawEnd.getTime() >= start.getTime() ? rawEnd : start;
    const group = groupField
      ? groupKeyOf(row, groupField, options.resolveNodeTitle)
      : undefined;

    const record: GanttRecord = {
      [GANTT_ROW_ID]: row.id,
      [GANTT_TITLE]:
        displayText(
          titleField ? row.cells[titleField.id] : undefined,
          titleField ?? undefined,
          options.resolveNodeTitle,
        ) || GANTT_FIXED.untitled,
      [GANTT_START]: toISODate(start),
      [GANTT_END]: toISODate(end),
    };
    if (progressField) {
      record[GANTT_PROGRESS] = progressPercent(row.cells[progressField.id]);
    }

    if (!groupField || !group) {
      tasks.push(record);
      continue;
    }
    record[GANTT_GROUP_KEY] = group.key;
    const bucket = groups.get(group.key);
    if (bucket) {
      bucket.records.push(record);
    } else {
      groups.set(group.key, { label: group.label, records: [record] });
    }
  }

  // Ungrouped: `rows` order, exactly like the ungrouped timeline.
  if (!groupField) return tasks;

  const collapsed = options.collapsed ?? new Set<string>();
  const ordered = orderGroups(groups, groupField);
  const records: GanttRecord[] = [];
  for (const [key, bucket] of ordered) {
    records.push(
      groupHeaderRecord(key, bucket.label, bucket.records, collapsed.has(key)),
    );
    if (!collapsed.has(key)) records.push(...bucket.records);
  }
  return records;
}

/** The group a row belongs to: its option label, or the 未分组 bucket. */
function groupKeyOf(
  row: DataRow,
  groupField: DatabaseField,
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined,
): { key: string; label: string } | null {
  const label = displayText(
    row.cells[groupField.id],
    groupField,
    resolveNodeTitle,
  );
  if (!label) {
    return { key: GANTT_UNGROUPED_KEY, label: GANTT_FIXED.ungroupedLabel };
  }
  return { key: label, label };
}

/**
 * Groups in the order the field declares its options, then anything the option
 * list does not know about in first-appearance order, with 未分组 last.
 *
 * The same rule the kanban's lanes follow, so one field orders its groups the
 * same way in both views. A `multiSelect` row lands in the group of its *joined*
 * label (a row in two options has no single lane either) — grouping is a
 * read-out, not a move.
 */
function orderGroups(
  groups: Map<string, { label: string; records: GanttRecord[] }>,
  groupField: DatabaseField,
): Array<[string, { label: string; records: GanttRecord[] }]> {
  const entries = [...groups.entries()];
  const declared = new Map(
    (groupField.options ?? []).map((option, index) => [option.name, index]),
  );
  return entries.sort((a, b) => {
    if (a[0] === GANTT_UNGROUPED_KEY) return 1;
    if (b[0] === GANTT_UNGROUPED_KEY) return -1;
    const left = declared.get(a[1].label);
    const right = declared.get(b[1].label);
    if (left !== undefined && right !== undefined) return left - right;
    if (left !== undefined) return -1;
    if (right !== undefined) return 1;
    return 0;
  });
}

/**
 * The synthetic header row a group opens with.
 *
 * It is a `project` record spanning every task of the group (even the ones a
 * fold hides), so the summary bar keeps stating the group's real range while its
 * members are away. The arrow and the count are **data**: the task list is a
 * canvas, so there is no React node to hang a disclosure control on — the row's
 * own click toggles it, and the title is what the user reads the state from.
 */
export function groupHeaderRecord(
  key: string,
  label: string,
  records: readonly GanttRecord[],
  collapsed: boolean,
): GanttRecord {
  let start = records[0]?.[GANTT_START] ?? toISODate(new Date());
  let end = records[0]?.[GANTT_END] ?? start;
  for (const record of records) {
    if (record[GANTT_START] < start) start = record[GANTT_START];
    const recordEnd = record[GANTT_END] ?? record[GANTT_START];
    if (recordEnd > end) end = recordEnd;
  }
  return {
    [GANTT_ROW_ID]: groupRowId(key),
    [GANTT_TITLE]: groupTitle(label, records.length, collapsed),
    [GANTT_START]: start,
    [GANTT_END]: end,
    [GANTT_GROUP_KEY]: key,
    [GANTT_GROUP_LABEL]: label,
    [GANTT_GROUP_COUNT]: records.length,
    type: "project",
  };
}

/**
 * What a group row says: an arrow, the label, and — once folded — how many tasks
 * are hidden (a folded group is the one case where the count is not implied by
 * the rows below it).
 */
export function groupTitle(
  label: string,
  count: number,
  collapsed: boolean,
): string {
  return collapsed ? `▸ ${label}（${count}）` : `▾ ${label}`;
}

/** The row id a group header row is keyed by. */
export function groupRowId(groupKey: string): string {
  return `group:${groupKey}`;
}

/** The group key behind a group header row, or `undefined` for a task. */
export function groupKeyOfRecord(record: GanttRecord): string | undefined {
  return record.type === "project" ? record[GANTT_GROUP_KEY] : undefined;
}

// —— record → readout ————————————————————————————————————————————————

/**
 * Describes a task / group row for the hover readout.
 *
 * The row is looked up by the caller: the record is a view model and holds no
 * cells, so the `config.tooltipFields` values come from the source row. A group
 * row has no row behind it — its readout is the span it summarises.
 */
export function readTaskReadout(
  record: GanttRecord,
  row: DataRow | undefined,
  fields: readonly DatabaseField[],
  config: GanttViewConfig,
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined,
): GanttTaskReadout {
  const details: GanttTaskDetail[] = [];
  if (row) {
    for (const field of resolveTooltipFields(fields, config.tooltipFields)) {
      const cell = row.cells[field.id];
      const text = displayText(cell, field, resolveNodeTitle);
      if (!text) continue;
      details.push({
        fieldId: field.id,
        name: field.name,
        text,
        color: toColor(cell, field) ?? undefined,
      });
    }
  }

  return {
    rowId: record[GANTT_ROW_ID],
    title:
      record.type === "project"
        ? (record[GANTT_GROUP_LABEL] ?? record[GANTT_TITLE])
        : record[GANTT_TITLE],
    dateText: formatISODateRange(
      record[GANTT_START],
      record[GANTT_END],
      GANTT_FIXED.locale,
    ),
    progressText:
      record[GANTT_PROGRESS] === undefined
        ? undefined
        : `${Math.round(record[GANTT_PROGRESS])}%`,
    groupCount: record[GANTT_GROUP_COUNT],
    details,
  };
}

/** A localised day label; falls back to the ISO day when the locale is unusable. */
function formatDay(iso: string, locale: string): string {
  const date = fromISODate(iso);
  if (!date) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return iso;
  }
}

/**
 * `2026-05-20 → 2026-05-22`, collapsing a single-day span to one date.
 *
 * Both ends are inclusive (VTable-Gantt's own convention), so there is nothing
 * to subtract here — a task that starts and ends on the same day says one date.
 */
export function formatISODateRange(
  start: string,
  end: string | undefined,
  locale: string,
): string {
  const first = formatDay(start, locale);
  if (!end || end === start) return first;
  return `${first} → ${formatDay(end, locale)}`;
}

// —— gesture → cells ————————————————————————————————————————————————————

/** One cell a drag writes, in the shape `onCellChange` takes. */
export interface GanttCellWrite {
  rowId: string;
  fieldId: string;
  cell: DatabaseCell;
}

/**
 * The cells a dragged task bar maps onto.
 *
 * `start` / `end` come straight from VTable-Gantt's `change_date_range`, whose
 * dates are inclusive; the end cell is written only when the view actually has an
 * end field (a one-day task has nowhere to put a span). An end before the start
 * is not a range and degrades to a single day.
 */
export function taskRangeToCells(
  range: { rowId: string; start: Date | null; end: Date | null },
  config: Pick<GanttViewConfig, "startField" | "endField">,
): GanttCellWrite[] {
  if (!range.start) return [];
  const end =
    range.end && range.end.getTime() >= range.start.getTime()
      ? range.end
      : range.start;

  const writes: GanttCellWrite[] = [];
  if (config.startField) {
    writes.push({
      rowId: range.rowId,
      fieldId: config.startField,
      cell: dateCell(range.start),
    });
  }
  if (config.endField) {
    writes.push({
      rowId: range.rowId,
      fieldId: config.endField,
      cell: dateCell(end),
    });
  }
  return writes;
}
