// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

/**
 * Gantt data view — the rows of a table laid out on a time axis and edited by
 * dragging (gantt.md).
 *
 * The shell owns four things and nothing else:
 *
 * - **the field mapping** (`startField` / `endField` / `titleField` /
 *   `progressField` / `groupByField`), resolved against the *live* schema on every
 *   render so a deleted field degrades into guidance instead of a crash;
 * - **the write path**: a dragged or resized bar becomes `onCellChange` calls for
 *   the start / end cells, and a dragged progress handle for the progress cell.
 *   Whether a write is possible at all is the host's capability (`movable` /
 *   `progressEditable`) — there is no second switch to consult;
 * - **the readout and the fold state**: the hover tooltip is the only React state
 *   here besides which groups are folded, and both are why the canvas surface is
 *   `memo`-wrapped (see `board/gantt-surface.tsx`);
 * - **the guidance**: with no date field (or no dated row) there is no timeline to
 *   draw, and VTable-Gantt must not be constructed for an empty one.
 *
 * Grouping is ours, not the library's: `rowsToGanttRecords` emits a synthetic 分组
 * header row per group whose click folds it, and a folded group simply leaves its
 * tasks out of the record list.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { ChartGantt } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import type { GanttViewConfig } from "@workspace/interfaces";

import { DataViewEmptyState } from "../../shared/empty-state";
import { useRecordActions } from "../../shared/record-actions";
import { useDataViewThemeTokens } from "../../shared/theme-tokens";
import type { DataViewRendererProps } from "../../source/types";
import { GanttSurface, type GanttPoint } from "./board/gantt-surface";
import { TaskHoverReadout } from "./board/task-readout";
import { buildGanttTheme } from "./canvas/theme";
import {
  GANTT_FIXED,
  dateFields,
  groupableFields,
  numberFields,
  resolveEndField,
  resolveGroupField,
  resolveStartField,
  resolveTaskColumnTitle,
  resolveTitleField,
} from "./core/config";
import {
  GANTT_ROW_ID,
  readTaskReadout,
  rowsToGanttRecords,
  taskRangeToCells,
  toISODate,
} from "./core/schema";
import { GanttToolbar } from "./toolbar/gantt-toolbar";

/** The fold state of one group field's groups. */
interface CollapseState {
  /** The group field the keys belong to; a different field starts clean. */
  fieldId: string | undefined;
  keys: ReadonlySet<string>;
}

const NO_GROUPS: ReadonlySet<string> = new Set<string>();

/**
 * What the pointer is over: the anchored point and the row behind it.
 *
 * The *readout* is derived during render rather than captured with the pointer,
 * so a write that lands while the pointer is still on a bar (a drag ends on the
 * bar) updates the tooltip instead of leaving the pre-drag dates on screen.
 */
interface HoverState {
  rowId: string;
  point: GanttPoint;
}

export function GanttDataView({
  source,
  config,
  readOnly,
  onCellChange,
  onConfigChange,
  onFieldsChange,
  resolveNodeTitle,
  className,
}: DataViewRendererProps<GanttViewConfig>) {
  useI18n();

  const tokens = useDataViewThemeTokens(GANTT_FIXED.theme);
  const theme = useMemo(() => buildGanttTheme(tokens), [tokens]);

  // The host may pass these as fresh closures on every render; the records memo
  // below must not depend on their identity.
  const resolveNodeTitleRef = useRef(resolveNodeTitle);
  resolveNodeTitleRef.current = resolveNodeTitle;

  const startField = resolveStartField(source.fields, config.startField);
  const endField = resolveEndField(
    source.fields,
    config.endField,
    config.startField,
  );
  const groupField = resolveGroupField(source.fields, config.groupByField);

  const dateFieldList = useMemo(
    () => dateFields(source.fields),
    [source.fields],
  );
  const numberFieldList = useMemo(
    () => numberFields(source.fields),
    [source.fields],
  );
  const groupableFieldList = useMemo(
    () => groupableFields(source.fields),
    [source.fields],
  );

  const canEditData = !readOnly && Boolean(onCellChange);
  const canConfigure = Boolean(onConfigChange);
  const today = useMemo(() => toISODate(new Date()), []);

  /**
   * What the task list's column is called: the config value, else the node this
   * view lives in, else 任务 (`core/config.ts`). Resolved here because the surface
   * is handed a plain string — it knows nothing about the node it draws.
   */
  const taskColumnTitle = resolveTaskColumnTitle(
    config.taskColumnTitle,
    source.nodeTitle,
  );

  /**
   * Which groups are folded, scoped to the field they were folded under: a view
   * whose group field changed shows every group open rather than silently
   * inheriting keys that now name something else.
   */
  const [collapse, setCollapse] = useState<CollapseState>({
    fieldId: undefined,
    keys: NO_GROUPS,
  });
  const collapsed =
    collapse.fieldId === groupField?.id ? collapse.keys : NO_GROUPS;
  const groupFieldIdRef = useRef(groupField?.id);
  groupFieldIdRef.current = groupField?.id;

  const records = useLocaleMemo(
    () =>
      startField
        ? rowsToGanttRecords(source, config, {
            collapsed,
            resolveNodeTitle: (nodeId) => resolveNodeTitleRef.current?.(nodeId),
          })
        : [],
    [source, config, startField, collapsed],
  );

  /** The shell's record surface: a click opens the record editor. */
  const recordActions = useRecordActions();

  /**
   * What the gantt already shows (the mapped roles and the readout's own fields)
   * is not repeated at the top of the record editor.
   */
  const hiddenFieldIds = useMemo(() => {
    const shown = new Set<string>(
      [
        config.startField,
        config.endField,
        config.titleField,
        config.progressField,
        config.groupByField,
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
    config.progressField,
    config.groupByField,
    config.tooltipFields,
    source.fields,
  ]);
  const hiddenFieldIdsRef = useRef<readonly string[]>(hiddenFieldIds);
  hiddenFieldIdsRef.current = hiddenFieldIds;

  const [hover, setHover] = useState<HoverState | null>(null);

  /**
   * Everything the memoized surface's callbacks need, refreshed every render, so
   * the callbacks themselves can be `[]`-stable and a hover never rebuilds the
   * canvas.
   */
  const latest = useRef({
    source,
    config,
    records,
    recordActions,
    onCellChange,
  });
  latest.current = {
    source,
    config,
    records,
    recordActions,
    onCellChange,
  };

  /** The date cells a drag writes, resolved against the live schema. */
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

  const handleDateRangeChange = useCallback(
    (rowId: string, start: Date, end: Date) => {
      const { onCellChange: write } = latest.current;
      if (!write) return;
      for (const cell of taskRangeToCells(
        { rowId, start, end },
        writeConfig(),
      )) {
        write(cell.rowId, cell.fieldId, cell.cell);
      }
    },
    [writeConfig],
  );

  /** 打开记录: the shell's unified record editor, on every host kind. */
  const handleTaskClick = useCallback((rowId: string) => {
    setHover(null);
    latest.current.recordActions.openRecord(rowId, {
      hiddenFieldIds: hiddenFieldIdsRef.current,
    });
  }, []);

  /**
   * A right-click opens the shell's unified record menu at the pointer.
   *
   * A bar is a canvas shape and a task-list row is a `ListTable` cell, so neither
   * can wrap its record in a Radix trigger — the surface reports the pointer and
   * the shell shows the same menu every other view shows.
   */
  const handleTaskContextMenu = useCallback(
    (rowId: string, point: GanttPoint) => {
      setHover(null);
      latest.current.recordActions.openRecordMenu(point, rowId, {
        hiddenFieldIds: hiddenFieldIdsRef.current,
      });
    },
    [],
  );

  const handleTaskEnter = useCallback(
    (rowId: string, point: GanttPoint) => setHover({ rowId, point }),
    [],
  );

  const handleTaskLeave = useCallback(() => setHover(null), []);

  const handleToggleGroup = useCallback((groupKey: string) => {
    const fieldId = groupFieldIdRef.current;
    setCollapse((previous) => {
      const keys = new Set(
        previous.fieldId === fieldId ? previous.keys : NO_GROUPS,
      );
      if (keys.has(groupKey)) keys.delete(groupKey);
      else keys.add(groupKey);
      return { fieldId, keys };
    });
  }, []);

  /**
   * The hover readout, always derived from the *current* record list. A 分组
   * header row has no source row behind it — its readout is the span it
   * summarises, which lives on the record itself.
   */
  const hoverReadout = useLocaleMemo(() => {
    if (!hover) return null;
    const record = records.find(
      (candidate) => candidate[GANTT_ROW_ID] === hover.rowId,
    );
    if (!record) return null;
    const row = source.rows.find((candidate) => candidate.id === hover.rowId);
    return readTaskReadout(record, row, source.fields, config, (nodeId) =>
      resolveNodeTitleRef.current?.(nodeId),
    );
  }, [hover, records, source, config]);

  /** A timeline needs a start field *and* at least one dated row. */
  const canDraw = Boolean(startField) && records.length > 0;

  return (
    <div
      data-dataview-gantt
      className={cn(
        // The shell's renderer box never scrolls; this view clips itself and owns
        // its own scrolling (dataview/AGENTS.md gotchas). A canvas library sizes
        // itself from this box's rounded pixels, so it must not be given the
        // chance to spill.
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <GanttToolbar
        source={source}
        config={config}
        canConfigure={canConfigure}
        dateFields={dateFieldList}
        numberFields={numberFieldList}
        groupableFields={groupableFieldList}
        onConfigChange={onConfigChange}
        onFieldsChange={onFieldsChange}
      />
      {canDraw ? (
        <div className="min-h-0 w-full flex-1 overflow-hidden">
          <GanttSurface
            records={records}
            viewMode={config.viewMode}
            rowHeight={config.rowHeight}
            showWeekends={config.showWeekends}
            showTodayLine={config.showTodayLine}
            taskColumnTitle={taskColumnTitle}
            today={today}
            themeMode={tokens.mode}
            movable={canEditData}
            resizable={canEditData && Boolean(endField)}
            theme={theme}
            onDateRangeChange={handleDateRangeChange}
            onTaskClick={handleTaskClick}
            onTaskContextMenu={handleTaskContextMenu}
            onTaskEnter={handleTaskEnter}
            onTaskLeave={handleTaskLeave}
            onToggleGroup={handleToggleGroup}
          />
        </div>
      ) : (
        <GanttGuidance
          fieldCount={source.fields.length}
          dateFieldCount={dateFieldList.length}
          hasStartField={Boolean(startField)}
          hasTitleField={Boolean(
            resolveTitleField(source.fields, config.titleField),
          )}
        />
      )}
      {hover && hoverReadout && (
        <TaskHoverReadout point={hover.point} readout={hoverReadout} />
      )}
    </div>
  );
}

/** What to do when there is no timeline to draw. */
function GanttGuidance({
  fieldCount,
  dateFieldCount,
  hasStartField,
  hasTitleField,
}: {
  fieldCount: number;
  dateFieldCount: number;
  hasStartField: boolean;
  hasTitleField: boolean;
}) {
  const { t } = useI18n();

  if (fieldCount === 0) {
    return (
      <DataViewEmptyState
        icon={ChartGantt}
        title={t("这张表还没有字段")}
        description={t(
          "先在表格视图中添加字段，再回来按起止日期把记录铺到时间轴上。",
        )}
        className="flex-1"
      />
    );
  }

  if (dateFieldCount === 0) {
    return (
      <DataViewEmptyState
        icon={ChartGantt}
        title={t("甘特图需要一个「日期」字段")}
        description={t(
          "甘特图把每行画成一条起止日期之间的任务条。先用表格视图添加一个「日期」字段（例如「开始日」），再回到甘特图选择它。",
        )}
        className="flex-1"
      />
    );
  }

  if (!hasStartField) {
    return (
      <DataViewEmptyState
        icon={ChartGantt}
        title={t("还没有选择开始日期")}
        description={t(
          "在上方工具条的「字段配置」里选择任务的开始日期，记录就会落到时间轴上。",
        )}
        className="flex-1"
      />
    );
  }

  return (
    <DataViewEmptyState
      icon={ChartGantt}
      title={t("还没有带日期的记录")}
      description={
        hasTitleField
          ? t(
              "在开始日期字段里填上日期，任务就会画在时间轴上；结束日期留空的任务按单日显示。",
            )
          : t("在开始日期字段里填上日期，任务就会画在时间轴上。")
      }
      className="flex-1"
    />
  );
}
