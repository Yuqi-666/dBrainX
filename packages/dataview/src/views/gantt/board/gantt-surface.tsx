// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The imperative VTable-Gantt surface.
 *
 * Wrapped in `memo` and driven entirely through stable callbacks: a gantt is a
 * canvas that redraws itself, so a React re-render must never rebuild it. The
 * same rule the calendar's `<FullCalendar>` follows.
 *
 * Three things about the library shape this file:
 *
 * 1. **It is constructed once per *structure*, not per render.** VTable-Gantt
 *    reads its presentation (granularity, row height, weekend columns, the 今日线,
 *    the theme, whether bars may be dragged at all) from the constructor options,
 *    so those live in {@link structureKey}; **records** go in through
 *    `setRecords`, which is what a data write actually is.
 * 2. **It mutates the records it was given.** A drag writes the new dates onto
 *    the record object in place before firing `change_date_range`; our records
 *    are rebuilt from the source on every render, so the shell's write is what
 *    makes the change real, and a failed write is corrected by the next
 *    `setRecords`.
 * 3. **It owns its own DOM, its own resize observation and its own context-menu
 *    suppression** (it observes the container we hand it and calls
 *    `preventDefault` on the native menu), so this component renders exactly one
 *    empty, clipped box and hangs a React readout/menu off the pointer instead.
 *
 * Group rows are ordinary records too — a flat list whose group headers carry
 * `type: "project"`. The library's own `groupBy` is declared but unimplemented in
 * 1.26.8, and its nested-children model disables the task list's tree, so the
 * folding is ours: a group row's click toggles the group and the shell rebuilds
 * the record list without the folded tasks.
 */
import { memo, useEffect, useRef } from "react";
import { Gantt, TYPES } from "@visactor/vtable-gantt";
import type { GanttConstructorOptions } from "@visactor/vtable-gantt";
import { cn } from "@workspace/ui/lib/utils";
import type { GanttViewConfig } from "@workspace/interfaces";

import type { GanttTheme } from "../canvas/theme";
import {
  GANTT_FIXED,
  buildTimelineScales,
  taskBarWidth,
  timelineColWidth,
} from "../core/config";
import {
  GANTT_END,
  GANTT_PROGRESS,
  GANTT_ROW_ID,
  GANTT_START,
  GANTT_TITLE,
  groupKeyOfRecord,
  type GanttRecord,
} from "../core/schema";

/** A point in viewport coordinates, for a menu or a readout anchor. */
export interface GanttPoint {
  x: number;
  y: number;
}

export interface GanttSurfaceProps {
  records: GanttRecord[];
  viewMode: GanttViewConfig["viewMode"];
  rowHeight: number;
  showWeekends: boolean;
  showTodayLine: boolean;
  /**
   * What the task list's column is called (表头).
   *
   * Resolved by the shell — the config value, else the host node's name, else
   * 任务 (`core/config.ts`'s `resolveTaskColumnTitle`) — because the surface
   * knows nothing about the node it is drawn in. Unlike the rest of the
   * presentation this is **not** part of {@link GanttSurfaceImpl}'s
   * `structureKey`: a header is one column title, and rebuilding the chart for it
   * would drop the scroll position and the split every time someone renames the
   * node. It goes through `updateColumns` instead.
   */
  taskColumnTitle: string;
  /** The 今日线's `YYYY-MM-DD`, resolved by the shell once per mount. */
  today: string;
  /** The theme's mode — a light/dark switch is a different chart. */
  themeMode: "light" | "dark";
  /** Host allows cell writes → bars may be dragged. */
  movable: boolean;
  /** Host allows cell writes *and* an end date field resolves → resizable. */
  resizable: boolean;
  theme: GanttTheme;
  onDateRangeChange: (rowId: string, start: Date, end: Date) => void;
  onTaskClick: (rowId: string) => void;
  onTaskContextMenu: (rowId: string, point: GanttPoint) => void;
  onTaskEnter: (rowId: string, point: GanttPoint) => void;
  onTaskLeave: () => void;
  onToggleGroup: (groupKey: string) => void;
  className?: string;
}

/**
 * The gantt's own event payloads, structurally.
 *
 * `federatedEvent` is a VRender pointer event whose client coordinates live
 * either on a `client` point or as `clientX` / `clientY`, depending on which
 * handler fired; the native event is the fallback. Typed here rather than
 * imported because the library re-exports VRender's types only through a
 * namespace, and neither shape is what a React panel needs anyway.
 */
interface GanttBarEventArgs {
  record?: unknown;
  event?: Event | null;
  federatedEvent?: unknown;
}

/** A viewport point, however the library happened to hand the event over. */
function viewportPoint(
  args: GanttBarEventArgs,
  fallback: HTMLElement | null,
): GanttPoint {
  const federated = args.federatedEvent as
    | {
        client?: { x?: number; y?: number };
        clientX?: number;
        clientY?: number;
      }
    | undefined;
  const client = federated?.client;
  if (client && typeof client.x === "number" && typeof client.y === "number") {
    return { x: client.x, y: client.y };
  }
  if (
    federated &&
    typeof federated.clientX === "number" &&
    typeof federated.clientY === "number"
  ) {
    return { x: federated.clientX, y: federated.clientY };
  }
  const native = args.event as MouseEvent | null | undefined;
  if (native && typeof native.clientX === "number") {
    return { x: native.clientX, y: native.clientY };
  }
  // Last resort: the surface's own center, so a menu never lands at the origin.
  const rect = fallback?.getBoundingClientRect();
  return rect
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : { x: 0, y: 0 };
}

/** The row id a record carries, or `undefined` for a foreign record. */
function rowIdOf(record: unknown): string | undefined {
  const value = (record as Record<string, unknown> | undefined)?.[GANTT_ROW_ID];
  return typeof value === "string" ? value : undefined;
}

/** A `change_date_range` payload reduced to what the write path needs. */
function rangeOf(args: {
  record?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}): { rowId: string; start: Date; end: Date } | null {
  const rowId = rowIdOf(args.record);
  if (!rowId) return null;
  const start = new Date(args.startDate as string | number | Date);
  const end = new Date(args.endDate as string | number | Date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { rowId, start, end };
}

/** A bar's style function target: the record behind the bar. */
function barRecordOf(args: unknown): GanttRecord | undefined {
  return (args as { taskRecord?: GanttRecord } | undefined)?.taskRecord;
}

/** What the library accepts for the task list's `columns`. */
type TaskListColumns = NonNullable<
  NonNullable<GanttConstructorOptions["taskListTable"]>["columns"]
>;

/**
 * The task list's single column: the task's title, and the hierarchy drawn on it.
 *
 * A factory because the column's **title** is the one part of it that changes at
 * runtime (表头 = the node's name by default, and a node can be renamed while a
 * gantt is open) while everything else is fixed. It is the same definition the
 * constructor gets and the one `updateColumns` is handed below, so the two can
 * never drift.
 */
function taskListColumns(title: string): TaskListColumns {
  return [
    {
      field: GANTT_TITLE,
      title,
      width: GANTT_FIXED.taskListColumnWidth,
      /**
       * The hierarchy, drawn by us.
       *
       * A 分组 header and its tasks are the *same* record shape in one flat
       * list, so nothing about the library's layout says which is which:
       * the header sits at the panel's edge and reads heavier, its tasks are
       * indented under it. The row is resolved with
       * `getCellOriginRecord` (the live record — unlike an event's cached
       * `originData`, see the fold gotcha below); the header row itself is
       * skipped so the column title keeps its own inset.
       */
      style: (args) => {
        if (args.row < args.table.columnHeaderLevelCount) return {};
        const record = args.table.getCellOriginRecord(args.col, args.row) as
          | GanttRecord
          | undefined;
        if (record?.type === "project") {
          return { padding: [0, 8, 0, 8], fontWeight: 600 };
        }
        return { padding: [0, 8, 0, GANTT_FIXED.taskListIndent] };
      },
    },
  ];
}

function GanttSurfaceImpl({
  records,
  viewMode,
  rowHeight,
  showWeekends,
  showTodayLine,
  taskColumnTitle,
  today,
  themeMode,
  movable,
  resizable,
  theme,
  onDateRangeChange,
  onTaskClick,
  onTaskContextMenu,
  onTaskEnter,
  onTaskLeave,
  onToggleGroup,
  className,
}: GanttSurfaceProps) {
  useI18n();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const ganttRef = useRef<Gantt | null>(null);
  /** The record array the live instance already has (identity comparison). */
  const appliedRecordsRef = useRef<readonly GanttRecord[] | null>(null);
  /** The header the live task list already shows (see the title effect). */
  const appliedTitleRef = useRef<string | null>(null);

  /**
   * Everything the library callbacks read, refreshed on every render.
   *
   * The callbacks are registered once per instance — they must keep their
   * identity for the lifetime of the chart — so they reach the live props
   * through here, exactly like the table and the calendar do. The title is here
   * for the same reason: the constructor effect only re-runs on a structure
   * change, so it must read the *current* header, not the one its render saw.
   */
  const latest = useRef({
    records,
    taskColumnTitle,
    onDateRangeChange,
    onTaskClick,
    onTaskContextMenu,
    onTaskEnter,
    onTaskLeave,
    onToggleGroup,
  });
  latest.current = {
    records,
    taskColumnTitle,
    onDateRangeChange,
    onTaskClick,
    onTaskContextMenu,
    onTaskEnter,
    onTaskLeave,
    onToggleGroup,
  };

  /**
   * The presentation, serialized: a change here is a *different* chart, so the
   * instance is rebuilt. Records are deliberately **not** keyed here — they are
   * applied by `setRecords` so an edit keeps the scroll position and the split.
   */
  const structureKey = [
    viewMode,
    rowHeight,
    showWeekends ? "weekend" : "no-weekend",
    showTodayLine ? "today" : "no-today",
    themeMode,
    movable ? "movable" : "readonly",
    resizable ? "resizable" : "fixed-size",
  ].join("|");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const current = latest.current;

    const scales = buildTimelineScales(viewMode).map((scale) => ({
      ...scale,
      rowHeight: GANTT_FIXED.headerRowHeight,
      style: {
        fontSize: theme.fontSize,
        // The axis is chrome: it stays a step below the task names.
        color: theme.mutedForeground,
        fontWeight: "500",
      },
    }));

    /** A 分组 header is a summary bar, not a task. */
    const isTaskBar = (args: unknown) => barRecordOf(args)?.type !== "project";

    const gantt = new Gantt(container, {
      records: current.records,
      taskKeyField: GANTT_ROW_ID,
      // One flat record list. A group header is a synthetic `project` record
      // spanning its tasks, drawn and folded by this view.
      tasksShowMode: TYPES.TasksShowMode.Tasks_Separate,
      taskBar: {
        startDateField: GANTT_START,
        endDateField: GANTT_END,
        progressField: GANTT_PROGRESS,
        labelText: `{${GANTT_TITLE}}`,
        barStyle: {
          barColor: theme.barColor,
          completedBarColor: theme.completedBarColor,
          width: taskBarWidth(rowHeight),
          cornerRadius: 4,
          borderLineWidth: 0,
        },
        projectStyle: {
          barColor: theme.groupBarColor,
          completedBarColor: theme.groupBarColor,
          width: Math.max(6, Math.round(taskBarWidth(rowHeight) * 0.4)),
          cornerRadius: 2,
          borderLineWidth: 0,
        },
        labelTextStyle: {
          fontFamily: theme.fontFamily,
          fontSize: theme.fontSize,
          // The label is drawn *outside* the bar (`orient` forces it), so it
          // never fights the fill and one colour serves a bar and a summary.
          orient: "right",
          color: theme.labelColor,
          outsideColor: theme.labelColor,
          padding: [0, 0, 0, 6],
        },
        hoverBarStyle: { barOverlayColor: theme.hoverOverlayColor },
        // The library already refuses to drag a `project` bar; these gates also
        // keep the resize icons off a group's summary.
        moveable: movable ? isTaskBar : false,
        resizable: resizable ? isTaskBar : false,
        // The progress *fill* is a read-out (the 进度 field), not a handle: the
        // library draws its drag handle 3px below the bar's bottom edge, where
        // the hover it belongs to is already gone, so it cannot be grabbed
        // (verified in the browser). Progress is edited in the record editor.
        progressAdjustable: false,
        // Row order belongs to the table view (`onRowReorder`); in
        // `Tasks_Separate` the vertical axis is already pinned.
        dragOrder: false,
        // Growing the timeline out from under a drag would rewrite the range a
        // user is arranging; the range follows the data.
        moveToExtendDateRange: false,
        selectable: true,
      },
      taskListTable: {
        // 表头 = the resolved title; see `taskListColumns` and the live update
        // effect below (the title is the one part of this column that moves).
        columns: taskListColumns(current.taskColumnTitle),
        theme: theme.taskListTheme,
        // Nothing in this panel is *selected*: a click already means "open this
        // record" or "fold this group", and VTable's own selection paint (its
        // default blue, which the gantt's theme merge keeps) would otherwise
        // leave a highlight on a row the user has moved on from.
        select: { disableSelect: true },
      },
      timelineHeader: {
        colWidth: timelineColWidth(viewMode),
        backgroundColor: theme.muted,
        hideWeekend: !showWeekends,
        verticalLine: { lineColor: theme.border, lineWidth: 1 },
        horizontalLine: { lineColor: theme.border, lineWidth: 1 },
        scales,
      },
      grid: {
        backgroundColor: theme.background,
        weekendBackgroundColor: theme.weekendBackgroundColor,
        verticalLine: { lineColor: theme.border, lineWidth: 1 },
        horizontalLine: { lineColor: theme.border, lineWidth: 1 },
        verticalLineDependenceOnTimeScale: "day",
      },
      frame: {
        outerFrameStyle: {
          borderColor: theme.border,
          borderLineWidth: 0,
          cornerRadius: 0,
        },
        verticalSplitLine: { lineColor: theme.border, lineWidth: 1 },
        horizontalSplitLine: { lineColor: theme.border, lineWidth: 1 },
        // The task list's width is a working preference, and the divider is the
        // only way to change it.
        verticalSplitLineMoveable: true,
      },
      rowHeight,
      headerRowHeight: GANTT_FIXED.headerRowHeight,
      markLine: showTodayLine
        ? {
            date: today,
            content: translate("今天"),
            contentStyle: {
              color: theme.markLineTextColor,
              backgroundColor: theme.markLineColor,
              fontSize: 10,
              lineHeight: 16,
              cornerRadius: 2,
            },
            style: {
              lineColor: theme.markLineColor,
              lineWidth: 1,
              lineDash: [4, 3],
            },
            scrollToMarkLine: true,
          }
        : undefined,
      underlayBackgroundColor: theme.background,
      scrollStyle: theme.scrollStyle,
      // The node content can be inside a dialog or a scrolled page: the gantt
      // must not hand its scroll on to the parent at the timeline's edges.
      overscrollBehavior: "none",
    } satisfies GanttConstructorOptions);

    ganttRef.current = gantt;
    appliedRecordsRef.current = current.records;
    appliedTitleRef.current = current.taskColumnTitle;

    gantt.on("change_date_range", (args) => {
      const range = rangeOf(args);
      if (!range) return;
      latest.current.onDateRangeChange(range.rowId, range.start, range.end);
    });

    /**
     * What a record means on click — the same answer a task-list row gives:
     * a 分组 header folds (there is no row behind it to open), a task opens the
     * shared record editor.
     */
    const activate = (record: GanttRecord | undefined) => {
      if (!record) return;
      const groupKey = groupKeyOfRecord(record);
      if (groupKey) {
        latest.current.onToggleGroup(groupKey);
        return;
      }
      const rowId = rowIdOf(record);
      if (rowId) latest.current.onTaskClick(rowId);
    };

    gantt.on("click_task_bar", (args) => activate(args.record as GanttRecord));

    gantt.on("contextmenu_task_bar", (args) => {
      const record = args.record as GanttRecord | undefined;
      // A group summary has no record to open a menu for.
      if (!record || groupKeyOfRecord(record)) return;
      const rowId = rowIdOf(record);
      if (!rowId) return;
      latest.current.onTaskContextMenu(
        rowId,
        viewportPoint(args, containerRef.current),
      );
    });

    gantt.on("mouseenter_task_bar", (args) => {
      const rowId = rowIdOf(args.record);
      if (!rowId) return;
      latest.current.onTaskEnter(
        rowId,
        viewportPoint(args, containerRef.current),
      );
    });

    gantt.on("mouseleave_task_bar", () => {
      latest.current.onTaskLeave();
    });

    /**
     * The left panel is a real `ListTable`, so a click on a *row* arrives as a
     * table event rather than a bar event: a group row folds its group, a task
     * row opens the record — the meanings the bars have.
     *
     * The record is resolved **by row index into the record list we applied**,
     * not from the event's `originData`: the list is one row per record in
     * `setRecords` order, while `originData` keeps pointing at the records the
     * table was *constructed* with — after a fold removed rows it resolved a
     * visible row to a task that was no longer on screen (verified in the
     * browser). `originData` is only the fallback for a row we cannot place.
     */
    const listTable = gantt.taskListTableInstance;
    const recordAt = (args: {
      col: number;
      row: number;
      originData?: unknown;
    }): GanttRecord | undefined => {
      const index = args.row - listTable!.columnHeaderLevelCount;
      const applied = latest.current.records[index];
      if (applied) return applied;
      return args.originData as GanttRecord | undefined;
    };

    listTable?.on("click_cell", (args) => {
      if (listTable.isHeader(args.col, args.row)) return;
      activate(recordAt(args));
    });

    listTable?.on("contextmenu_cell", (args) => {
      if (listTable.isHeader(args.col, args.row)) return;
      const record = recordAt(args);
      const rowId = record ? rowIdOf(record) : undefined;
      if (!rowId) return;
      latest.current.onTaskContextMenu(
        rowId,
        viewportPoint(
          { event: args.event as Event | null | undefined },
          containerRef.current,
        ),
      );
    });

    return () => {
      ganttRef.current = null;
      // `release()` tears down the listeners, both canvases and the DOM the
      // library appended. Without it StrictMode's double mount would leave two
      // charts stacked in the same box.
      gantt.release();
    };
    // `today` is read once per instance on purpose — it is the day the view was
    // opened, and the theme's mode travels in `structureKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  /** The data, not the structure: an edit keeps the scroll and the split. */
  useEffect(() => {
    if (appliedRecordsRef.current === records) return;
    appliedRecordsRef.current = records;
    ganttRef.current?.setRecords(records);
  }, [records]);

  /**
   * The 表头, which is the one column property that moves.
   *
   * `updateColumns` on the task list's own `ListTable` rather than a rebuild: the
   * title's default *is* the host node's name, and a node is renamed in the very
   * editor this view lives in — every keystroke of that rename would rebuild the
   * chart, lose the scroll position and reset the split. Passing the same
   * `taskListColumns` the constructor got keeps the hierarchy `style` function and
   * the column width with it.
   *
   * A no-op right after a rebuild (the constructor already used the current title)
   * — hence `appliedTitleRef`, which the constructor effect seeds.
   */
  useEffect(() => {
    if (appliedTitleRef.current === taskColumnTitle) return;
    appliedTitleRef.current = taskColumnTitle;
    ganttRef.current?.taskListTableInstance?.updateColumns(
      taskListColumns(taskColumnTitle),
    );
  }, [taskColumnTitle]);

  return (
    <div
      ref={containerRef}
      data-dataview-gantt-canvas
      // `relative` is load-bearing, not decoration: the library appends its own
      // `position: absolute` layers — the timeline canvas (`.vtable-gantt`,
      // moved right by `left: <taskListWidth>`) and the split-line handle — and
      // without a positioned ancestor they resolve against the page instead. The
      // two canvases then overlap by the container's offset and the divider is
      // drawn above the chart (both verified in the browser).
      //
      // `isolate` (`isolation: isolate`) is load-bearing for the same reason:
      // `verticalSplitResizeLine` is appended to *this* box with
      // `z-index: 100`, and a stacking context here is what keeps that number
      // local. Without it the divider competed with layers outside the box and
      // painted over the record page's `z-30` scrim (verified: the blurred
      // overlay left the split line crisp across it).
      className={cn(
        "relative isolate h-full min-h-0 w-full overflow-hidden",
        className,
      )}
    />
  );
}

export const GanttSurface = memo(GanttSurfaceImpl);
