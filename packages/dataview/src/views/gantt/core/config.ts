// SPDX-License-Identifier: AGPL-3.0-only

import { getLocale, translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * Gantt config resolution — the self-healing layer between a persisted
 * `GanttViewConfig` and the concrete fields a timeline is built from.
 *
 * A view config outlives the schema it was written against (a date field can be
 * deleted or retyped between two openings), so nothing here trusts the persisted
 * ids: every resolver answers "what is the *live* thing this id means" and
 * degrades to `null`/`""` instead of throwing (README §5.1). The renderer turns
 * that into the missing-field guidance.
 *
 * The view is a set of **roles** — 开始日期 / 结束日期 / 标题 / 进度 / 分组 — exactly
 * like the calendar (§ 字段配置), and this module is where each role's rules live:
 * the end date must be a *different* date field than the start, the progress must
 * be a `number`, and the group must be a 单选/多选. The 时间粒度 → `scales` mapping
 * is here too, so the surface only hands VTable what this module decided.
 *
 * Pure module: no React, no third-party library.
 */
import type { GanttViewConfig, DatabaseField } from "@workspace/interfaces";

/** The three timeline granularities the 视图 panel offers, in display order. */
export const GANTT_VIEW_MODES: ReadonlyArray<{
  value: GanttViewConfig["viewMode"];
  label: string;
}> = [
  {
    value: "day",
    get label() {
      return translate("日");
    },
  },
  {
    value: "week",
    get label() {
      return translate("周");
    },
  },
  {
    value: "month",
    get label() {
      return translate("月");
    },
  },
];

/** 行高 choices (the table's 低 / 中 / 高, in px). */
export const GANTT_ROW_HEIGHTS: ReadonlyArray<{
  value: number;
  label: string;
}> = [
  {
    value: 28,
    get label() {
      return translate("低");
    },
  },
  {
    value: 36,
    get label() {
      return translate("中");
    },
  },
  {
    value: 48,
    get label() {
      return translate("高");
    },
  },
];

/** The row height a config that names none opens with. */
export const GANTT_DEFAULT_ROW_HEIGHT = 36;

// —— field resolution ————————————————————————————————————————————————————

export function isDateField(
  field: Pick<DatabaseField, "type"> | undefined,
): boolean {
  return field?.type === "date";
}

/** Every field a start/end date may point at, in schema order. */
export function dateFields(fields: readonly DatabaseField[]): DatabaseField[] {
  return fields.filter(isDateField);
}

/**
 * The live start field — the one required role.
 *
 * `null` when the id is empty (nothing chosen yet) or no longer names a `date`
 * field; the two cases the guidance UI distinguishes by looking at
 * {@link dateFields}.
 */
export function resolveStartField(
  fields: readonly DatabaseField[],
  startField: string | undefined,
): DatabaseField | null {
  const field = fields.find((candidate) => candidate.id === startField);
  return isDateField(field) ? (field ?? null) : null;
}

/**
 * The live end field: the configured one, unless it does not resolve, is not a
 * date, or is the start field itself (a task cannot end where it begins).
 */
export function resolveEndField(
  fields: readonly DatabaseField[],
  endField: string | undefined,
  startFieldId: string | undefined,
): DatabaseField | null {
  if (!endField || endField === startFieldId) return null;
  const field = fields.find((candidate) => candidate.id === endField);
  return isDateField(field) ? (field ?? null) : null;
}

/** The live task-title field: the configured one, else the primary column. */
export function resolveTitleField(
  fields: readonly DatabaseField[],
  titleField: string | undefined,
): DatabaseField | null {
  return (
    fields.find((field) => field.id === titleField) ??
    fields.find((field) => field.type === "text") ??
    fields[0] ??
    null
  );
}

/** Every `number` field a progress may point at, in schema order. */
export function numberFields(
  fields: readonly DatabaseField[],
): DatabaseField[] {
  return fields.filter((field) => field.type === "number");
}

/** The live progress field: a `number` field, or `null`. */
export function resolveProgressField(
  fields: readonly DatabaseField[],
  progressField: string | undefined,
): DatabaseField | null {
  const field = fields.find((candidate) => candidate.id === progressField);
  return field?.type === "number" ? field : null;
}

/** Field types whose options give a timeline something to group by. */
export function groupableFields(
  fields: readonly DatabaseField[],
): DatabaseField[] {
  return fields.filter(
    (field) => field.type === "select" || field.type === "multiSelect",
  );
}

/** The live group field: a 单选/多选 field, or `null`. */
export function resolveGroupField(
  fields: readonly DatabaseField[],
  groupByField: string | undefined,
): DatabaseField | null {
  const field = fields.find((candidate) => candidate.id === groupByField);
  if (field?.type === "select" || field?.type === "multiSelect") return field;
  return null;
}

/** The live hover-readout fields (a deleted id silently drops out). */
export function resolveTooltipFields(
  fields: readonly DatabaseField[],
  tooltipFields: readonly string[] | undefined,
): DatabaseField[] {
  if (!tooltipFields || tooltipFields.length === 0) return [];
  const byId = new Map(fields.map((field) => [field.id, field]));
  return tooltipFields
    .map((fieldId) => byId.get(fieldId))
    .filter((field): field is DatabaseField => field !== undefined);
}

/**
 * The task list's column title (表头).
 *
 * Three steps, in order: what the config says, then **the node's own name**, then
 * the generic 任务. Naming the set after the node it lives in is the default
 * because the rows are not always tasks — the same view draws 里程碑 or 排期 — and
 * the node is the one thing that already describes them. An explicit config value
 * wins, so a user who wants the old word back, or a different one, keeps it.
 *
 * Pure: the shell resolves this from `source.nodeTitle` and hands the surface a
 * plain string, so the surface never sees the node.
 */
export function resolveTaskColumnTitle(
  taskColumnTitle: string | undefined,
  nodeTitle: string | undefined,
): string {
  return (
    taskColumnTitle?.trim() || nodeTitle?.trim() || GANTT_FIXED.taskColumnTitle
  );
}

// —— timeline ——————————————————————————————————————————————————————————————

/** The date a scale's label callback is handed (VTable's shape, ours here). */
export interface GanttScaleDate {
  startDate: Date;
  endDate: Date;
  dateIndex: number;
}

/**
 * One timeline header row.
 *
 * Structurally a subset of VTable-Gantt's `ITimelineScale`, kept library-free so
 * this module stays pure; the surface hands these straight to the constructor and
 * adds the themed label colour.
 */
export interface GanttTimelineScale {
  unit: "year" | "month" | "week" | "day";
  step: number;
  startOfWeek?: "monday" | "sunday";
  /** Header row height for this level (defaults to `headerRowHeight`). */
  rowHeight?: number;
  /** Label for one column of this level. */
  format?: (date: GanttScaleDate) => string;
}

/** `2026年` — the year row of the 月 granularity. */
function formatYear(date: GanttScaleDate): string {
  return getLocale() === "zh-CN"
    ? `${date.startDate.getFullYear()}年`
    : String(date.startDate.getFullYear());
}

/** `6月` — the month row. */
function formatMonth(date: GanttScaleDate): string {
  return new Intl.DateTimeFormat(getLocale(), { month: "short" }).format(
    date.startDate,
  );
}

/** `20` — the day row of the 日 granularity. */
function formatDayOfMonth(date: GanttScaleDate): string {
  return String(date.startDate.getDate());
}

/** `6/15` — the Monday a 周 column starts on. */
function formatWeekStart(date: GanttScaleDate): string {
  return `${date.startDate.getMonth() + 1}/${date.startDate.getDate()}`;
}

/**
 * The header rows for a granularity.
 *
 * Always two levels, coarse on top: a bare day or month row leaves the user
 * without a sense of where they are once the timeline is scrolled. The **last**
 * entry is the finest unit — VTable derives its own date map (`minDate`,
 * `maxDate`, column widths) from the deepest scale, which is why the day / week
 * / month distinction has to be the deepest one.
 */
export function buildTimelineScales(
  viewMode: GanttViewConfig["viewMode"],
): GanttTimelineScale[] {
  switch (viewMode) {
    case "day":
      return [
        { unit: "month", step: 1, format: formatMonth },
        { unit: "day", step: 1, format: formatDayOfMonth },
      ];
    case "month":
      return [
        { unit: "year", step: 1, format: formatYear },
        { unit: "month", step: 1, format: formatMonth },
      ];
    case "week":
    default:
      return [
        { unit: "month", step: 1, format: formatMonth },
        {
          unit: "week",
          step: 1,
          startOfWeek: "monday",
          format: formatWeekStart,
        },
      ];
  }
}

/**
 * The width of one column of the deepest scale, in px.
 *
 * A 周 column holds seven days and a 月 column about thirty, so a single width
 * would either crush the labels or produce a uselessly long scroll. A 日 column
 * is narrow on purpose: the 日 granularity is for reading individual days, and a
 * wide column would push a project of a few weeks off screen.
 */
export function timelineColWidth(
  viewMode: GanttViewConfig["viewMode"],
): number {
  switch (viewMode) {
    case "day":
      return 36;
    case "month":
      return 96;
    case "week":
    default:
      return 72;
  }
}

/** The task bar's thickness for a row height (a bar is never the full row). */
export function taskBarWidth(rowHeight: number): number {
  return Math.max(8, Math.min(20, Math.round(rowHeight * 0.5)));
}

// —— the fixed defaults ——————————————————————————————————————————————————

/**
 * The gantt's presentation, as constants rather than config.
 *
 * Same reasoning as the calendar's `CALENDAR_FIXED`: these keys were either
 * switches whose default was the only sensible answer or implementation detail
 * of the timeline. How much a user may **write** is deliberately absent — that is
 * the host's capability (a drag needs cell writes), so the shell derives it and
 * a read-only collection cannot move a bar.
 */
export const GANTT_FIXED = {
  /** Follows `next-themes`, like every other canvas view. */
  theme: "auto",
  /** Date cells are days; the label is localised by the readout, not the axis. */
  get locale() {
    return getLocale();
  },
  /** One header row's height. */
  headerRowHeight: 28,
  /** The task list panel's column — the title, and nothing that repeats a bar. */
  taskListColumnWidth: 200,
  /**
   * What the task list's column is called when nothing names it better.
   *
   * The last step of {@link resolveTaskColumnTitle}: the view prefers the node's
   * own name, and this is what a node with no name yet (or a bare source with no
   * `nodeTitle`) shows.
   */
  get taskColumnTitle() {
    return translate("任务");
  },
  /**
   * How far a task's title is indented under its 分组 header row.
   *
   * The grouping is the view's own (the library's `groupBy` is unimplemented in
   * 1.26.8), so nothing indents the task list for us: without this, a group
   * header and its tasks read as one flat list of equal rows.
   */
  taskListIndent: 20,
  /** A title a gantt can always show; the readout names the empty case. */
  get untitled() {
    return translate("未命名");
  },
  /** The label "group" a row with no group value is filed under. */
  get ungroupedLabel() {
    return translate("未分组");
  },
} as const;
