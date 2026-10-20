// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

/**
 * Kanban data view — rows grouped into lanes by a 单选/多选 field, one card per
 * row, draggable between lanes (kanban.md).
 *
 * The shell owns three things and nothing else:
 *
 * - **the board value** (`columns`), seeded from the source and re-seeded
 *   whenever the source or the config changes. Re-seeding during render (rather
 *   than in an effect) is React's documented "adjust state when a prop changes"
 *   pattern: it keeps the board and the source from ever showing two different
 *   truths for a frame, which for a drag is the difference between a card
 *   staying put and flashing back.
 * - **the write path**: a lane change — by drag *or* by the card menu's 移动到 —
 *   becomes one `onCellChange(rowId, groupField, cell)`. Lane-internal order is
 *   never written (no storage for it; kanban.md §8), and a lane reorder is a
 *   config write. The renderer still persists nothing itself (README §3.4).
 * - **the gates** derived from host capabilities: dragging needs cell writes,
 *   new cards need row inserts, renaming a lane needs schema writes, and a
 *   `multiSelect` grouping disables dragging outright (a card lives in several
 *   lanes, so "which option does this drop replace?" has no answer).
 *
 * The board only renders when a group field resolves; otherwise the body is the
 * guidance that says which field to pick (or which field to add).
 */
import { useMemo, useState } from "react";
import { SquareKanban } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

import { createEmptyDataRow } from "../../source/row-utils";
import {
  cardSettingsPatch,
  cardHiddenFieldIds,
  type CardSettings,
} from "../../shared/card-ops";
import { DataViewEmptyState } from "../../shared/empty-state";
import { useRecordActions } from "../../shared/record-actions";
import type {
  DataViewRendererProps,
  KanbanViewConfig,
} from "../../source/types";
import { KanbanBoard } from "./board/kanban-board";
import {
  KANBAN_UNASSIGNED_LANE_ID,
  buildKanbanBoard,
  moveCardToLane,
  type KanbanCard,
} from "./core/board";
import { cellForLane, groupableFields, patchFieldOption } from "./core/config";
import { KanbanToolbar } from "./toolbar/kanban-toolbar";

export function KanbanDataView({
  source,
  config,
  readOnly,
  onCellChange,
  onConfigChange,
  onRowInsert,
  onFieldsChange,
  resolveNodeTitle,
  resolveNode,
  className,
}: DataViewRendererProps<KanbanViewConfig>) {
  useI18n();

  const recordActions = useRecordActions();
  const model = useLocaleMemo(
    () => buildKanbanBoard(source, config, resolveNodeTitle),
    [source, config, resolveNodeTitle],
  );

  const [columns, setColumns] = useState(model.columns);
  const [builtModel, setBuiltModel] = useState(model);
  if (builtModel !== model) {
    // A new source (the host's write landed, or a filter changed) or a new
    // config: rebuild the board in the same render that sees it.
    setBuiltModel(model);
    setColumns(model.columns);
  }

  const groupField = model.groupField;
  const settings = model.settings;
  const canEditData = !readOnly && Boolean(onCellChange);
  const canInsertRow = !readOnly && Boolean(onRowInsert);
  const canEditOptions = !readOnly && Boolean(onFieldsChange);

  // The 显示 panel's three switches were the default every time, so the host's
  // capabilities are the whole rule now: cell writes make a card draggable, row
  // inserts make a lane offer "new card" (plus the two structural gates).
  const canDragCards = canEditData && Boolean(groupField) && !model.multiValue;
  const canCreateCard = canInsertRow && Boolean(groupField);
  const canReorderLanes = Boolean(onConfigChange) && Boolean(groupField);

  /**
   * What the board already shows (the lane field, the card's title, cover and
   * fields) is not repeated at the top of the record editor; the rest folds into
   * its 隐藏字段 block.
   */
  const hiddenFieldIds = useMemo(
    () =>
      cardHiddenFieldIds(source.fields, [
        settings.titleField,
        settings.coverField,
        config.groupByField,
        ...settings.cardFields,
      ]),
    [config.groupByField, settings, source.fields],
  );

  /** 卡片配置 writes back into this view's own config (the card half). */
  const handleSettingsChange = (next: CardSettings) => {
    onConfigChange?.({ ...config, ...cardSettingsPatch(next) });
  };

  const handleCardLaneChange = (card: KanbanCard, laneId: string) => {
    if (!groupField) return;
    onCellChange?.(
      card.rowId,
      groupField.id,
      cellForLane(groupField, laneId, KANBAN_UNASSIGNED_LANE_ID),
    );
    // Optimistic: the host's write returns as a new source a tick later.
    setColumns((current) => moveCardToLane(current, card.key, laneId));
  };

  const handleCreateCard = (laneId: string) => {
    if (!groupField || !onRowInsert) return;
    onRowInsert(
      createEmptyDataRow(source.fields, {
        fieldId: groupField.id,
        cell: cellForLane(groupField, laneId, KANBAN_UNASSIGNED_LANE_ID),
      }),
    );
  };

  const handleOptionSave = (
    optionId: string,
    patch: { name: string; color?: string },
  ) => {
    if (!groupField || !onFieldsChange) return;
    // Renaming / recolouring an option leaves every cell valid (cells store the
    // option id), so no rows travel with the schema write.
    onFieldsChange(
      patchFieldOption(source.fields, groupField.id, optionId, patch),
    );
  };

  const body = groupField ? (
    <KanbanBoard
      model={model}
      columns={columns}
      onColumnsChange={setColumns}
      onCardLaneChange={canEditData ? handleCardLaneChange : undefined}
      onLaneOrderChange={
        onConfigChange
          ? (laneOrder) => onConfigChange({ ...config, laneOrder })
          : undefined
      }
      hiddenFieldIds={hiddenFieldIds}
      onCreateCard={canCreateCard ? handleCreateCard : undefined}
      onOptionSave={canEditOptions ? handleOptionSave : undefined}
      resolveNode={resolveNode}
      resolveNodeTitle={resolveNodeTitle}
      onOpenNode={recordActions.onOpenNode}
      canDragCards={canDragCards}
      canReorderLanes={canReorderLanes}
    />
  ) : (
    <KanbanGuidance
      fieldCount={source.fields.length}
      groupableCount={groupableFields(source.fields).length}
    />
  );

  return (
    <div
      data-dataview-kanban
      className={cn(
        // The shell's renderer box never scrolls; this view clips itself and
        // lets the lane strip scroll horizontally (dataview/AGENTS.md gotchas).
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <KanbanToolbar
        source={source}
        config={config}
        settings={settings}
        canConfigure={Boolean(onConfigChange)}
        onConfigChange={onConfigChange}
        onFieldsChange={onFieldsChange}
        onSettingsChange={handleSettingsChange}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{body}</div>
    </div>
  );
}

/** What to do when there is no usable group field. */
function KanbanGuidance({
  fieldCount,
  groupableCount,
}: {
  fieldCount: number;
  groupableCount: number;
}) {
  const { t } = useI18n();

  if (fieldCount === 0) {
    return (
      <DataViewEmptyState
        icon={SquareKanban}
        title={t("这张表还没有字段")}
        description={t(
          "先在表格视图中添加字段，再回来按某个「单选」字段分列。",
        )}
      />
    );
  }

  return (
    <DataViewEmptyState
      icon={SquareKanban}
      title={
        groupableCount > 0
          ? t("还没有选择分组字段")
          : t("看板需要一个单选或多选字段")
      }
      description={
        groupableCount > 0
          ? t(
              "在上方工具条的「分组」里选择用于分列的字段，卡片就会按它的选项落到各列。",
            )
          : t(
              "看板把行按某个字段的选项分列。先用表格视图添加一个「单选」字段（例如「状态」），再回到看板选择它。",
            )
      }
    />
  );
}
