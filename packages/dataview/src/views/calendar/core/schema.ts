// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * The calendar's data-transformation layer: `rows` + a field mapping → calendar
 * events (calendar.md §3), and a drag/resize/select gesture → the date cells it
 * writes back.
 *
 * Everything here is pure (only *types* come from `@fullcalendar/core`), so the
 * mapping rules stay reviewable independently of the FullCalendar instance the
 * shell drives.
 *
 * Date-only fields create all-day events with inclusive stored end dates.
 * Fields with time create timed events with exact start and end boundaries.
 */
import type { EventApi, EventInput } from "@fullcalendar/core";
import type {
  CalendarViewConfig,
  DatabaseCell,
  DatabaseField,
  DataRow,
  DataViewSource,
  NodeId,
} from "@workspace/interfaces";

import { displayText, toColor, toDate } from "../../../source/cell-resolver";
import { createEmptyDataRow } from "../../../source/row-utils";
import { contrastTextColor } from "../../../shared/color";
import {
  resolveColorField,
  resolveEndField,
  resolveStartField,
  resolveTitleField,
  resolveTooltipFields,
} from "./config";

/** Placeholder title for a row whose title cell is empty. */
export const CALENDAR_UNTITLED = "未命名";

/** One field readout on the hover tooltip. */
export interface CalendarDetail {
  fieldId: string;
  name: string;
  text: string;
  /** Set for 单选/多选 so the readout can show the option's own colour. */
  color?: string;
}

/**
 * The payload every event carries in `extendedProps`.
 *
 * It travels on the event (rather than being looked up per hover) because
 * FullCalendar's own event objects are what its callbacks hand back — the shell
 * would otherwise have to re-derive "which row is this" on every mouse move.
 */
export interface CalendarEventRecord {
  rowId: string;
  /** `collection` only: the graph node behind the row. */
  nodeId?: string;
  /** The `config.tooltipFields` readout. */
  details: CalendarDetail[];
}

/**
 * A calendar event, structurally an `EventInput`.
 *
 * `id` is the row id (FullCalendar only needs it to be unique within the
 * calendar, and rows are unique), `extendedProps` is the record above.
 */
export interface CalendarEventInput extends EventInput {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  extendedProps: CalendarEventRecord;
}

// —— date conversion ————————————————————————————————————————————————————

/** The `YYYY-MM-DD` day a date lives on, in local time. */
export function toISODate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** A new `Date` `amount` days away (local midnight preserved). */
export function addDays(date: Date, amount: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + amount);
  return next;
}

/** The cell a date writes into a `date` field. `null` clears it. */
function toDateValue(date: Date, includeTime: boolean): string {
  const day = toISODate(date);
  return includeTime
    ? `${day}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    : day;
}

export function dateCell(date: Date | null, includeTime = false): DatabaseCell {
  return { type: "date", date: date ? toDateValue(date, includeTime) : null };
}

// —— rows → events ——————————————————————————————————————————————————————

/**
 * Projects every row with a usable start date onto a calendar event.
 *
 * A row whose start cell is empty (or unparseable) is skipped rather than
 * pinned to today — a calendar that invents dates is worse than one that omits
 * rows (calendar.md §3.1).
 */
export function rowsToEvents(
  source: DataViewSource,
  config: CalendarViewConfig,
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined,
): CalendarEventInput[] {
  const startField = resolveStartField(source.fields, config.startField);
  if (!startField) return [];

  const endField = resolveEndField(
    source.fields,
    config.endField,
    startField.id,
  );
  const titleField = resolveTitleField(source.fields, config.titleField);
  const colorField = resolveColorField(source.fields, config.colorField);
  const tooltipFields = resolveTooltipFields(
    source.fields,
    config.tooltipFields,
  );

  const events: CalendarEventInput[] = [];
  source.rows.forEach((row, index) => {
    const start = toDate(row.cells[startField.id]);
    if (!start) return;

    const rawEnd = endField ? toDate(row.cells[endField.id]) : null;
    // An end before the start is not a range; fall back to a single day.
    const end = rawEnd && rawEnd.getTime() >= start.getTime() ? rawEnd : null;

    const color = colorField
      ? toColor(row.cells[colorField.id], colorField)
      : null;

    events.push({
      id: row.id,
      title:
        displayText(
          titleField ? row.cells[titleField.id] : undefined,
          titleField ?? undefined,
          resolveNodeTitle,
        ) || translate(CALENDAR_UNTITLED),
      start: toDateValue(start, startField.includeTime ?? false),
      end: end
        ? endField?.includeTime
          ? toDateValue(end, true)
          : toISODate(addDays(end, 1))
        : undefined,
      allDay: !startField.includeTime,
      backgroundColor: color ?? undefined,
      borderColor: color ?? undefined,
      // The themed event text only fits the *untinted* default fill; an option
      // colour needs its own contrast decision (shared/color.ts).
      textColor: color ? contrastTextColor(color) : undefined,
      extendedProps: {
        rowId: row.id,
        nodeId:
          source.nodeIds?.[index] ??
          (source.kind === "collection" ? row.id : undefined),
        details: tooltipFields.map((field) => {
          const cell = row.cells[field.id];
          return {
            fieldId: field.id,
            name: field.name,
            text: displayText(cell, field, resolveNodeTitle),
            color: toColor(cell, field) ?? undefined,
          };
        }),
      },
    });
  });

  return events;
}

/**
 * Reads the record back off an event.
 *
 * FullCalendar types `extendedProps` as an open dictionary, so the shape is
 * checked once here instead of being cast at every call site; `event.id` is the
 * row id as well, which is the fallback when a foreign event (a user-supplied
 * source) is on the calendar.
 */
export function readEventRecord(event: EventApi): CalendarEventRecord {
  const props = event.extendedProps as Partial<CalendarEventRecord> | undefined;
  if (props && typeof props.rowId === "string") {
    return {
      rowId: props.rowId,
      nodeId: props.nodeId,
      details: Array.isArray(props.details) ? props.details : [],
    };
  }
  return { rowId: event.id, details: [] };
}

// —— event → hover / click readout ——————————————————————————————————————

/** What the hover tooltip shows for one event. */
export interface CalendarEventReadout {
  rowId: string;
  title: string;
  /** `2026-05-20` or `2026-05-20 → 2026-05-22`. */
  dateText: string;
  details: CalendarDetail[];
}

/** A localised day label; falls back to ISO when the locale is unusable. */
function formatDay(date: Date, locale: string, includeTime = false): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      ...(includeTime
        ? {
            hour: "2-digit" as const,
            minute: "2-digit" as const,
            hour12: false,
          }
        : {}),
    }).format(date);
  } catch {
    return toDateValue(date, includeTime);
  }
}

/**
 * Describes an event for the hover readout.
 *
 * FullCalendar's `end` is exclusive, so the last day shown is `end - 1`; a range
 * that covers one day collapses to a single date rather than "20 → 20".
 * Detail rows with an empty value are dropped — a readout of `—` rows is noise.
 */
export function readEventReadout(
  event: EventApi,
  locale: string,
): CalendarEventReadout {
  const record = readEventRecord(event);
  const start = event.start;
  const includeTime = !event.allDay;
  const lastDay = event.end
    ? event.allDay
      ? addDays(event.end, -1)
      : event.end
    : null;
  const sameDay =
    !start ||
    !lastDay ||
    (event.allDay
      ? toISODate(start) === toISODate(lastDay)
      : start.getTime() === lastDay.getTime());

  const dateText = start
    ? sameDay || !lastDay
      ? formatDay(start, locale, includeTime)
      : `${formatDay(start, locale, includeTime)} → ${formatDay(lastDay, locale, includeTime)}`
    : "";

  return {
    rowId: record.rowId,
    title: event.title,
    dateText,
    details: record.details.filter((detail) => detail.text !== ""),
  };
}

// —— gesture → cells ————————————————————————————————————————————————————

/** One cell a gesture writes, in the shape `onCellChange` takes. */
export interface CalendarCellWrite {
  rowId: string;
  fieldId: string;
  cell: DatabaseCell;
}

/**
 * The cells a date range maps onto.
 *
 * `start` is inclusive and `end` is FullCalendar's exclusive boundary, so the
 * end cell gets `end - 1 day`; a range that covers one day stores **no** end
 * value (rather than storing the start twice), which is what makes
 * "single-day" and "two-day" distinguishable in the table view.
 */
export function rangeToCells(
  range: { start: Date | null; end: Date | null },
  config: Pick<CalendarViewConfig, "startField" | "endField">,
  fields: readonly DatabaseField[] = [],
): Array<{ fieldId: string; cell: DatabaseCell }> {
  const writes: Array<{ fieldId: string; cell: DatabaseCell }> = [];
  const startWithTime =
    fields.find((field) => field.id === config.startField)?.includeTime ??
    false;
  const endWithTime =
    fields.find((field) => field.id === config.endField)?.includeTime ?? false;
  if (config.startField && range.start) {
    writes.push({
      fieldId: config.startField,
      cell: dateCell(range.start, startWithTime),
    });
  }

  if (config.endField) {
    const lastDay = range.end
      ? endWithTime
        ? range.end
        : addDays(range.end, -1)
      : null;
    const singleDay =
      !lastDay || !range.start || toISODate(lastDay) === toISODate(range.start);
    writes.push({
      fieldId: config.endField,
      cell: endWithTime
        ? dateCell(range.end, true)
        : dateCell(singleDay ? null : lastDay),
    });
  }

  return writes;
}

/** The `onCellChange` writes for a dropped / resized event. */
export function eventToCells(
  event: { rowId: string; start: Date | null; end: Date | null },
  config: Pick<CalendarViewConfig, "startField" | "endField">,
  fields: readonly DatabaseField[] = [],
): CalendarCellWrite[] {
  return rangeToCells(event, config, fields).map(({ fieldId, cell }) => ({
    rowId: event.rowId,
    fieldId,
    cell,
  }));
}

/**
 * The row a 框选 / 双击 creates: every field empty except the selected dates.
 *
 * The row id is minted here (`createEmptyDataRow`), so the host inserts exactly
 * the row this view already drew.
 */
export function selectionToRow(
  fields: DataViewSource["fields"],
  range: { start: Date | null; end: Date | null },
  config: Pick<CalendarViewConfig, "startField" | "endField">,
): DataRow {
  const row = createEmptyDataRow(fields);
  for (const { fieldId, cell } of rangeToCells(range, config, fields)) {
    row.cells[fieldId] = cell;
  }
  return row;
}
