// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

/**
 * Calendar data view — rows laid out on a time axis and edited by dragging
 * (calendar.md).
 *
 * The shell owns four things and nothing else:
 *
 * - **the field mapping** (`startField` / `endField` / `titleField` /
 *   `colorField` / `tooltipFields`), resolved against the *live* schema every
 *   render so a deleted field degrades into guidance instead of a crash;
 * - **the write path**: a drop, a resize, a 框选 or a double-click becomes
 *   `onCellChange` / `onRowInsert` calls, with FullCalendar's exclusive `end`
 *   converted to "the last day" in `core/schema.ts` and nowhere else. Whether a
 *   write is possible at all is the host's capability (`canEditData` /
 *   `canInsertRow`) — the 交互 panel is gone, so there is no second switch to
 *   consult;
 * - **the readout**: the hover tooltip, which is the only React state here — and
 *   the reason the FullCalendar surface is `memo`-wrapped (see
 *   `board/calendar-surface.tsx`). A click on an event opens the shared record
 *   editor, like every other view;
 * - **the presentation defaults**: locale / height / weekends / "now" line /
 *   day folding / theme come from `CALENDAR_FIXED` (`core/config.ts`), published
 *   as `--fc-*` variables on the calendar's own wrapper.
 *
 * The calendar only renders once a start date field resolves; otherwise the body
 * is the guidance that says which field to pick (or which field to add).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import type {
  CalendarApi,
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventHoveringArg,
} from "@fullcalendar/core";
import type {
  DateClickArg,
  EventResizeDoneArg,
} from "@fullcalendar/interaction";

import { DataViewEmptyState } from "../../shared/empty-state";
import { useDataViewThemeTokens } from "../../shared/theme-tokens";
import { useRecordActions } from "../../shared/record-actions";
import type {
  CalendarViewConfig,
  DataViewRendererProps,
} from "../../source/types";
import { EventHoverReadout, type EventAnchor } from "./board/event-readout";
import { CalendarSurface } from "./board/calendar-surface";
import {
  CALENDAR_FIXED,
  dateFields,
  fromFullCalendarView,
  isCalendarViewName,
  type CalendarViewName,
  readCalendarToolbarLayout,
  resolveEndField,
  resolveStartField,
  toFullCalendarView,
  writeCalendarToolbarLayout,
} from "./core/config";
import {
  eventToCells,
  readEventReadout,
  rowsToEvents,
  selectionToRow,
  type CalendarEventReadout,
} from "./core/schema";
import { buildCalendarThemeVars } from "./core/theme";
import { CalendarToolbar } from "./toolbar/calendar-toolbar";

/** The view a calendar opens in when the persisted one is not one of ours. */
const FALLBACK_VIEW: CalendarViewName = "dayGridMonth";

/** Viewport rect of the event element a readout hangs off. */
function rectOf(element: HTMLElement): EventAnchor {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** The hover tooltip's anchor + content — at most one is mounted. */
interface ReadoutState {
  rect: EventAnchor;
  readout: CalendarEventReadout;
}

export function CalendarDataView({
  source,
  config,
  readOnly,
  onCellChange,
  onOpenNode,
  onConfigChange,
  onRowInsert,
  onFieldsChange,
  resolveNodeTitle,
  className,
}: DataViewRendererProps<CalendarViewConfig>) {
  useI18n();

  const tokens = useDataViewThemeTokens(CALENDAR_FIXED.theme);
  const themeVars = useMemo(() => buildCalendarThemeVars(tokens), [tokens]);

  // The host may pass these as fresh closures on every render; the events memo
  // below must not depend on their identity, or a re-render would rebuild the
  // event list and make FullCalendar re-render its whole tree.
  const resolveNodeTitleRef = useRef(resolveNodeTitle);
  resolveNodeTitleRef.current = resolveNodeTitle;

  const startField = resolveStartField(source.fields, config.startField);
  const dateFieldList = useMemo(
    () => dateFields(source.fields),
    [source.fields],
  );

  const canEditData = !readOnly && Boolean(onCellChange);
  const canInsertRow = !readOnly && Boolean(onRowInsert);
  const canConfigure = Boolean(onConfigChange);
  /**
   * The header toolbar the surface actually gets: the persisted layout
   * normalized so the 今天 button is always there (the 视图 panel no longer
   * offers that switch — see `core/config.ts`).
   */
  const headerToolbar = useMemo(
    () =>
      writeCalendarToolbarLayout(
        readCalendarToolbarLayout(config.headerToolbar),
      ),
    [config.headerToolbar],
  );
  /** The shell's record surface: opening an event opens the record editor. */
  const recordActions = useRecordActions();

  /**
   * What the calendar already shows (the mapped date/title/colour fields and
   * the tooltip fields) is not repeated at the top of the record editor.
   */
  const hiddenFieldIds = useMemo(() => {
    const shown = new Set<string>(
      [
        config.startField,
        config.endField,
        config.titleField,
        config.colorField,
        ...(config.tooltipFields ?? []),
      ].filter((fieldId): fieldId is string => Boolean(fieldId)),
    );
    return source.fields
      .filter((field) => !shown.has(field.id))
      .map((field) => field.id);
  }, [
    config.startField,
    config.endField,
    config.titleField,
    config.colorField,
    config.tooltipFields,
    source.fields,
  ]);
  const hiddenFieldIdsRef = useRef<readonly string[]>(hiddenFieldIds);
  hiddenFieldIdsRef.current = hiddenFieldIds;

  const events = useLocaleMemo(
    () =>
      startField
        ? rowsToEvents(source, config, (nodeId) =>
            resolveNodeTitleRef.current?.(nodeId),
          )
        : [],
    [source, config, startField],
  );

  // Every FullCalendar callback below is stable (`[]` deps) so the memoized
  // surface never re-renders because of a hover; the shell's live values are
  // read through this ref instead.
  const latest = useRef({
    source,
    config,
    readOnly,
    onCellChange,
    onOpenNode,
    onConfigChange,
    onRowInsert,
    recordActions,
  });
  latest.current = {
    source,
    config,
    readOnly,
    onCellChange,
    onOpenNode,
    onConfigChange,
    onRowInsert,
    recordActions,
  };

  const apiRef = useRef<CalendarApi | null>(null);
  const [hover, setHover] = useState<ReadoutState | null>(null);
  const [createdRowId, setCreatedRowId] = useState<string | null>(null);

  // Open only once the host exposes the new row, including when insertion is
  // asynchronous or the calendar's current filters hide the record.
  useEffect(() => {
    if (
      !createdRowId ||
      !recordActions.source.rows.some((row) => row.id === createdRowId)
    )
      return;
    recordActions.openRecord(createdRowId, {
      hiddenFieldIds: hiddenFieldIdsRef.current,
    });
    setCreatedRowId(null);
    setHover(null);
  }, [createdRowId, recordActions]);

  const handleApi = useCallback((api: CalendarApi | null) => {
    apiRef.current = api;
  }, []);

  const safeView: CalendarViewName = isCalendarViewName(config.defaultView)
    ? config.defaultView
    : FALLBACK_VIEW;

  // `initialView` is only read at mount, so the toolbar's view switch (and a
  // persisted default) is applied imperatively. `datesSet` writes the view the
  // user picked in FullCalendar's own header back into the config, which lands
  // here as the same value — no loop.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || fromFullCalendarView(api.view.type) === safeView) return;
    api.changeView(toFullCalendarView(safeView));
  }, [safeView]);

  /** The date fields a gesture may write into, resolved against the schema. */
  const writeConfig = useCallback(() => {
    const { source: liveSource, config: liveConfig } = latest.current;
    const start = resolveStartField(liveSource.fields, liveConfig.startField);
    const end = resolveEndField(
      liveSource.fields,
      liveConfig.endField,
      start?.id,
    );
    return { startField: start?.id ?? "", endField: end?.id };
  }, []);

  /** 打开记录: the shell's unified record editor, on every host kind. */
  const openReadout = useCallback((readout: CalendarEventReadout) => {
    latest.current.recordActions.openRecord(readout.rowId, {
      hiddenFieldIds: hiddenFieldIdsRef.current,
    });
  }, []);

  /**
   * A right-click on an event opens the shell's unified record menu.
   *
   * The trigger cannot live inside the event: FullCalendar owns that DOM, and
   * the browser's `contextmenu` target is the library's `<a class="fc-event">`,
   * so a Radix trigger wrapping our content never sees the gesture. The surface
   * therefore reports the raw event and the shell shows the menu at the pointer.
   */
  const handleEventContextMenu = useCallback(
    (rowId: string, point: { x: number; y: number }) => {
      latest.current.recordActions.openRecordMenu(point, rowId, {
        hiddenFieldIds: hiddenFieldIdsRef.current,
      });
    },
    [],
  );

  const handleEventDrop = useCallback(
    (arg: EventDropArg | EventResizeDoneArg) => {
      const { onCellChange: write } = latest.current;
      if (!write) {
        arg.revert();
        return;
      }
      const rowId = readEventRecordId(arg);
      for (const cell of eventToCells(
        { rowId, start: arg.event.start, end: arg.event.end },
        writeConfig(),
        latest.current.source.fields,
      )) {
        write(cell.rowId, cell.fieldId, cell.cell);
      }
    },
    [writeConfig],
  );

  const createRangeRecord = useCallback(
    (range: { start: Date; end: Date | null }) => {
      const {
        source: liveSource,
        onRowInsert: insert,
        readOnly: locked,
      } = latest.current;
      if (!insert || locked) return;
      const row = selectionToRow(liveSource.fields, range, writeConfig());
      insert(row);
      setCreatedRowId(row.id);
    },
    [writeConfig],
  );

  const handleSelectRange = useCallback(
    (arg: DateSelectArg) => {
      // The mirror highlight is left over once the row exists; clear it so the
      // new event is what the user sees.
      apiRef.current?.unselect();
      // One day means "a click or a one-day drag", which is not a creation
      // gesture — 双击 (dateClick) covers the one-day case instead.
      const days = (arg.end.getTime() - arg.start.getTime()) / 86_400_000;
      if (arg.allDay && days <= 1) return;
      createRangeRecord({ start: arg.start, end: arg.end });
    },
    [createRangeRecord],
  );

  const handleAddDate = useCallback(
    (date: Date) => createRangeRecord({ start: date, end: null }),
    [createRangeRecord],
  );

  const handleDateDoubleClick = useCallback(
    (arg: DateClickArg) => {
      if (arg.jsEvent.detail >= 2) handleAddDate(arg.date);
    },
    [handleAddDate],
  );

  /**
   * A click on an event opens the record — the same gesture every other view
   * has, and the old 交互 panel's 点击事件 choice (弹出详情 / 不响应) is gone with
   * it. A right-click still opens the shared record menu.
   */
  const handleEventClick = useCallback(
    (arg: EventClickArg) => {
      setHover(null);
      openReadout(readEventReadout(arg.event, CALENDAR_FIXED.locale));
    },
    [openReadout],
  );

  const handleEventMouseEnter = useCallback((arg: EventHoveringArg) => {
    setHover({
      rect: rectOf(arg.el),
      readout: readEventReadout(arg.event, CALENDAR_FIXED.locale),
    });
  }, []);

  const handleEventMouseLeave = useCallback(() => {
    setHover(null);
  }, []);

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    const { config: liveConfig, onConfigChange: report } = latest.current;
    const type = fromFullCalendarView(arg.view.type);
    if (!report || !type) return;
    if (type === liveConfig.defaultView) return;
    // The user switched views from FullCalendar's own header button.
    report({ ...liveConfig, defaultView: type });
  }, []);

  const surface = (
    <CalendarSurface
      events={events}
      themeVars={themeVars}
      initialView={safeView}
      headerToolbar={headerToolbar}
      firstDay={config.firstDay}
      locale={CALENDAR_FIXED.locale}
      editable={canEditData}
      selectable={canInsertRow}
      onEventContextMenu={handleEventContextMenu}
      onApi={handleApi}
      onEventDrop={handleEventDrop}
      onEventResize={handleEventDrop}
      onSelectRange={handleSelectRange}
      onDateDoubleClick={handleDateDoubleClick}
      onAddDate={handleAddDate}
      onEventClick={handleEventClick}
      onEventMouseEnter={handleEventMouseEnter}
      onEventMouseLeave={handleEventMouseLeave}
      onDatesSet={handleDatesSet}
    />
  );

  return (
    <div
      data-dataview-calendar
      className={cn(
        // The shell's renderer box never scrolls; this view clips itself and
        // owns its own scrolling (dataview/AGENTS.md gotchas).
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <CalendarToolbar
        source={source}
        config={config}
        canConfigure={canConfigure}
        dateFields={dateFieldList}
        onConfigChange={onConfigChange}
        onFieldsChange={onFieldsChange}
      />
      <div
        className={cn(
          // The calendar fills the pane and scrolls internally (a time grid does
          // this on its own), so the pane itself never scrolls.
          "min-h-0 flex-1 overflow-hidden p-2",
        )}
      >
        <div className="h-full w-full" style={themeVars}>
          {startField ? (
            surface
          ) : (
            <CalendarGuidance
              fieldCount={source.fields.length}
              dateFieldCount={dateFieldList.length}
            />
          )}
        </div>
      </div>
      {hover && <EventHoverReadout rect={hover.rect} readout={hover.readout} />}
    </div>
  );
}

/** The row id behind a drag/resize gesture. */
function readEventRecordId(arg: EventDropArg | EventResizeDoneArg): string {
  const props = arg.event.extendedProps as { rowId?: string } | undefined;
  return typeof props?.rowId === "string" ? props.rowId : arg.event.id;
}

/** What to do when no start date field resolves. */
function CalendarGuidance({
  fieldCount,
  dateFieldCount,
}: {
  fieldCount: number;
  dateFieldCount: number;
}) {
  const { t } = useI18n();

  if (fieldCount === 0) {
    return (
      <DataViewEmptyState
        icon={CalendarDays}
        title={t("这张表还没有字段")}
        description={t(
          "先在表格视图中添加字段，再回来按日期把记录铺到日历上。",
        )}
      />
    );
  }

  return (
    <DataViewEmptyState
      icon={CalendarDays}
      title={
        dateFieldCount > 0
          ? t("还没有选择开始日期")
          : t("日历需要一个「日期」字段")
      }
      description={
        dateFieldCount > 0
          ? t(
              "在上方工具条的「字段」里选择事件的开始日期，记录就会落到对应的日子。",
            )
          : t(
              "日历把行按某个日期字段铺开。先用表格视图添加一个「日期」字段（例如「截止日」），再回到日历选择它。",
            )
      }
    />
  );
}
