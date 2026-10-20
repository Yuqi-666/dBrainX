// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

/**
 * Gallery data view — rows as a wall of cards, browsed visually (gallery.md).
 *
 * The shell owns four things and nothing else:
 *
 * - **the settings**: `readCardSettings` normalizes the persisted card half of
 *   the config (title / cover / card fields / 展示模式) once per render, and
 *   `rowsToCards` maps the source through the live schema with it, so a deleted
 *   field degrades into a smaller card instead of a crash;
 * - **selection**: the shared `useRowSelection` plus the anchor a Shift range
 *   extends from, feeding the selected card's own right-click menu (选择 /
 *   删除选中). Selection is always available — the old 显示 → 允许多选 switch only
 *   ever turned a working feature off — and it is a gesture, not a control on
 *   the card: Ctrl/Cmd-click, Shift-range, Space, Ctrl+A, Escape;
 * - **the write path**: a card delete is one `onRowDelete` call, 添加记录 one
 *   `onRowInsert`, a card click the shell's record editor (through
 *   `useRecordActions`), and 卡片配置 either a config write or a schema write
 *   through `onFieldsChange`. The renderer persists nothing itself (README
 *   §3.4);
 * - **the gates** derived from host capabilities.
 *
 * The card wall itself (layout, virtual window, cards) lives in `board/`.
 */
import { useCallback, useMemo, useRef } from "react";
import { Images, Plus } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";

import {
  cardSettingsPatch,
  readCardSettings,
  type CardSettings,
} from "../../shared/card-ops";
import { DataViewEmptyState } from "../../shared/empty-state";
import { useRecordActions } from "../../shared/record-actions";
import { useRowSelection } from "../../shared/use-row-selection";
import { createEmptyDataRow } from "../../source/row-utils";
import type {
  DataViewRendererProps,
  GalleryViewConfig,
} from "../../source/types";
import { GalleryBoard } from "./board/gallery-board";
import type { SelectRangeOptions } from "./board/gallery-card";
import { rowsToCards, type GalleryCard } from "./core/schema";
import { GalleryToolbar } from "./toolbar/gallery-toolbar";

export function GalleryDataView({
  source,
  config,
  readOnly,
  onConfigChange,
  onFieldsChange,
  onRowInsert,
  onRowDelete,
  resolveNodeTitle,
  resolveNode,
  className,
}: DataViewRendererProps<GalleryViewConfig>) {
  const { t } = useI18n();

  /** The shell's record surface: a card click opens the record editor. */
  const recordActions = useRecordActions();

  const settings = useMemo(() => readCardSettings(config), [config]);

  const cards = useLocaleMemo(
    () => rowsToCards(source, settings, resolveNodeTitle),
    [source, settings, resolveNodeTitle],
  );
  /** Every card shares one hidden-field list; the first is as good as any. */
  const hiddenFieldIds = useMemo(() => cards[0]?.hiddenFieldIds ?? [], [cards]);

  const rowIds = useMemo(() => cards.map((card) => card.rowId), [cards]);
  const { selectedIds, toggle, select, clear } = useRowSelection(rowIds);
  /** Where a Shift range starts: the last card touched on its own. */
  const anchorRef = useRef<string | null>(null);

  // A deleted row must not linger in the selection: the count and the bulk
  // delete both read this pruned list, never the raw set.
  const selectedRowIds = useMemo(
    () => rowIds.filter((rowId) => selectedIds.has(rowId)),
    [rowIds, selectedIds],
  );
  const selectedSet = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);

  const canConfigure = Boolean(onConfigChange);
  const canDelete = !readOnly && Boolean(onRowDelete);
  const canInsert = !readOnly && Boolean(onRowInsert);

  const handleOpen = useCallback(
    (card: GalleryCard) => {
      recordActions.openRecord(card.rowId, { hiddenFieldIds });
    },
    [recordActions, hiddenFieldIds],
  );

  // Ctrl/Cmd-click on a card selects rather than opens; Shift extends the
  // range and Space toggles the focused card.
  const handleToggleSelect = useCallback(
    (card: GalleryCard) => {
      anchorRef.current = card.rowId;
      toggle(card.rowId, { additive: true });
    },
    [toggle],
  );

  /**
   * Shift-click and Shift+arrow: everything between the anchor and the card
   * just reached. The anchor is the last card the user touched one at a time,
   * so extending twice from the same anchor replaces the range instead of
   * growing it — the behaviour a file list has.
   */
  const handleSelectRange = useCallback(
    (card: GalleryCard, { additive, anchor }: SelectRangeOptions) => {
      const anchorId = anchorRef.current ?? anchor?.rowId ?? card.rowId;
      anchorRef.current = anchorId;
      const from = rowIds.indexOf(anchorId);
      const to = rowIds.indexOf(card.rowId);
      if (from < 0 || to < 0) {
        toggle(card.rowId, { additive: true });
        return;
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      const range = rowIds.slice(start, end + 1);
      select(additive ? [...new Set([...selectedIds, ...range])] : range);
    },
    [rowIds, select, selectedIds, toggle],
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedRowIds.length === 0) return;
    onRowDelete?.(selectedRowIds);
    anchorRef.current = null;
    clear();
  }, [onRowDelete, selectedRowIds, clear]);

  const handleAddRecord = useCallback(() => {
    onRowInsert?.(createEmptyDataRow(source.fields));
  }, [onRowInsert, source.fields]);

  /** 卡片配置 writes back into this view's own config (the card half). */
  const handleSettingsChange = useCallback(
    (next: CardSettings) => {
      onConfigChange?.({ ...config, ...cardSettingsPatch(next) });
    },
    [config, onConfigChange],
  );

  const handleSelectAll = useCallback(() => {
    anchorRef.current = rowIds[0] ?? null;
    select(rowIds);
  }, [select, rowIds]);

  const handleClearSelection = useCallback(() => {
    anchorRef.current = null;
    clear();
  }, [clear]);

  const body =
    source.fields.length === 0 ? (
      <DataViewEmptyState
        icon={Images}
        title={t("这张表还没有字段")}
        description={t(
          "先在表格视图中添加字段（例如「标题」和「封面」），再回到画廊把它们排成卡片墙。",
        )}
      />
    ) : cards.length === 0 ? (
      <DataViewEmptyState
        icon={Images}
        title={t("还没有记录")}
        description={
          canInsert
            ? t("点下方按钮新增一条记录，新卡片会立刻出现在这里。")
            : t("在表格视图中新增记录，它们会立刻出现在这里。")
        }
      >
        {canInsert && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-3 text-xs font-normal"
            onClick={handleAddRecord}
          >
            <Plus className="size-3.5" />
            {t("添加记录")}{" "}
          </Button>
        )}
      </DataViewEmptyState>
    ) : (
      <GalleryBoard
        cards={cards}
        config={config}
        compact={settings.compact}
        resolveNode={resolveNode}
        resolveNodeTitle={resolveNodeTitle}
        onOpenNode={recordActions.onOpenNode}
        selectedIds={selectedSet}
        onOpen={handleOpen}
        onToggleSelect={handleToggleSelect}
        onSelectRange={handleSelectRange}
        onDeleteSelected={canDelete ? handleDeleteSelected : undefined}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
      />
    );

  return (
    <div
      data-dataview-gallery
      className={cn(
        // The shell's renderer box never scrolls; this view clips itself and
        // the card wall owns its own scrolling (dataview/AGENTS.md gotchas).
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <GalleryToolbar
        source={source}
        config={config}
        settings={settings}
        canConfigure={canConfigure}
        canInsert={canInsert}
        onConfigChange={onConfigChange}
        onFieldsChange={onFieldsChange}
        onSettingsChange={handleSettingsChange}
        onAddRecord={handleAddRecord}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{body}</div>
    </div>
  );
}
