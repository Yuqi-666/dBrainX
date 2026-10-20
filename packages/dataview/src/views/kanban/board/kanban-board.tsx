// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The kanban board: ReUI's drag-and-drop primitives assembled into lanes of
 * cards.
 *
 * This component renders and reports; it owns nothing but which lanes are
 * collapsed. The board value (`columns`) and every write are the shell's
 * (`kanban-data-view.tsx`), so a drop is expressed as a **lane change** — the
 * cell write, the optimistic board update and the 移动到 menu all funnel through
 * the same callback.
 *
 * Two REUI facts shape the code here:
 *
 * - **`onValueChange` is the live preview.** In the default (non-`onMove`) mode
 *   ReUI applies a cross-lane move to the value *while dragging*, so a drop is
 *   only distinguishable from a lane-internal reorder by comparing the commit's
 *   `activeContainer` with its `overContainer`. Lane-internal order deliberately
 *   stays local: the persisted model has no place for it (kanban.md §8).
 * - **Lane ids are the column order.** Columns render in `Object.keys(columns)`
 *   order so dnd-kit's `SortableContext` and the DOM agree; a column drop writes
 *   the new order to `config.laneOrder`, with the 未分组 pseudo-lane kept last.
 */
import { useCallback, useId, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, GripVertical, Plus } from "lucide-react";
import type { NodeData, NodeId } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";

import {
  Kanban,
  KanbanBoard as ReuiKanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanColumnHandle,
  KanbanItem,
  KanbanOverlay,
  type KanbanCommitMeta,
} from "../reui/kanban";
import {
  KANBAN_UNASSIGNED_LANE_ID,
  findCardByKey,
  type KanbanBoardModel,
  type KanbanCard,
  type KanbanLane,
} from "../core/board";
import { KanbanCardBody, KanbanCardItem } from "./kanban-card";
import { LaneOptionEditor } from "./lane-option-editor";

/** dnd-kit reads this for every item; it must be stable across renders. */
const getCardKey = (card: KanbanCard) => card.key;

export interface KanbanBoardProps {
  /** Lane metadata, title/card fields and the resolved group field. */
  model: KanbanBoardModel;
  /** The live board value (optimistic; the source is the truth). */
  columns: Record<string, KanbanCard[]>;
  onColumnsChange: (next: Record<string, KanbanCard[]>) => void;
  /** A card landed in another lane (drag or 移动到). */
  onCardLaneChange?: (card: KanbanCard, laneId: string) => void;
  /** Lanes were reordered by dragging a lane header. */
  onLaneOrderChange?: (laneOrder: string[]) => void;
  /** Fields the board already shows → folded into the record editor. */
  hiddenFieldIds?: readonly string[];
  onCreateCard?: (laneId: string) => void;
  /** Rename / recolour a lane (an option of the group field). */
  onOptionSave?: (
    optionId: string,
    patch: { name: string; color?: string },
  ) => void;
  /** Host lookup for a node cover / a relation label inside a card. */
  resolveNode?: (nodeId: string) => NodeData | undefined;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  onOpenNode?: (nodeId: NodeId) => void;
  canDragCards: boolean;
  canReorderLanes: boolean;
}

interface LaneHeaderProps {
  lane: KanbanLane;
  count: number;
  canCreate: boolean;
  canReorderLanes: boolean;
  canEditOption: boolean;
  onToggle: () => void;
  onCreate: () => void;
  onOptionSave: (patch: { name: string; color?: string }) => void;
}

function LaneHeader({
  lane,
  count,
  canCreate,
  canReorderLanes,
  canEditOption,
  onToggle,
  onCreate,
  onOptionSave,
}: LaneHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-1 px-1.5 py-1.5">
      {canReorderLanes && (
        <KanbanColumnHandle
          tabIndex={0}
          role="button"
          aria-label={translate("拖动泳道：{value1}", { value1: lane.name })}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-40 hover:opacity-100 focus-visible:opacity-100"
        >
          <GripVertical className="size-3.5" />
        </KanbanColumnHandle>
      )}
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: lane.color }}
      />
      {canEditOption ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={translate("编辑选项：{value1}", { value1: lane.name })}
              className="min-w-0 flex-1 truncate rounded px-0.5 text-left text-xs font-medium hover:text-primary focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              {lane.name}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <LaneOptionEditor
              name={lane.name}
              color={lane.color}
              onSave={onOptionSave}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <span
          className="min-w-0 flex-1 truncate px-0.5 text-xs font-medium"
          title={lane.name}
        >
          {lane.name}
        </span>
      )}
      <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
        {count}
      </span>
      {canCreate && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={translate("在「{value1}」新建卡片", {
            value1: lane.name,
          })}
          className="size-6 shrink-0 text-muted-foreground"
          onClick={onCreate}
        >
          <Plus className="size-3.5" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("折叠泳道")}
        className="size-6 shrink-0 text-muted-foreground"
        onClick={onToggle}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
    </div>
  );
}

export function KanbanBoard({
  model,
  columns,
  onColumnsChange,
  onCardLaneChange,
  onLaneOrderChange,
  hiddenFieldIds,
  onCreateCard,
  onOptionSave,
  resolveNode,
  resolveNodeTitle,
  onOpenNode,
  canDragCards,
  canReorderLanes,
}: KanbanBoardProps) {
  const { t } = useI18n();

  const [collapsedLaneIds, setCollapsedLaneIds] = useState<readonly string[]>(
    [],
  );
  // A stable id for dnd-kit's screen-reader instructions: without it the
  // library numbers them with a module counter, which differs between the
  // server render and hydration (React keeps the server's `aria-describedby`
  // and logs a mismatch). See `reui/kanban.tsx` — `id` goes to `DndContext`.
  const dndId = useId();

  const laneById = useMemo(
    () => new Map(model.lanes.map((lane) => [lane.id, lane])),
    [model.lanes],
  );
  const laneIds = Object.keys(columns);

  const toggleLane = (laneId: string) =>
    setCollapsedLaneIds((previous) =>
      previous.includes(laneId)
        ? previous.filter((id) => id !== laneId)
        : [...previous, laneId],
    );

  const handleValueCommit = useCallback(
    (
      value: Record<string, KanbanCard[]>,
      meta: KanbanCommitMeta<KanbanCard>,
    ) => {
      if (meta.kind === "column") {
        // 未分组 is a pseudo-lane: it is always rendered last, so it is not part
        // of the persisted option order.
        onLaneOrderChange?.(
          Object.keys(value).filter((id) => id !== KANBAN_UNASSIGNED_LANE_ID),
        );
        return;
      }
      if (!onCardLaneChange) return;
      // Same lane → a lane-internal reorder, which v1 keeps in local state only
      // (rows have one global order and no per-lane one).
      if (meta.activeContainer === meta.overContainer) return;
      const card = findCardByKey(value, meta.event.active.id);
      if (card) onCardLaneChange(card, meta.overContainer);
    },
    [onCardLaneChange, onLaneOrderChange],
  );

  return (
    <Kanban
      id={dndId}
      value={columns}
      onValueChange={onColumnsChange}
      getItemValue={getCardKey}
      onValueCommit={handleValueCommit}
      // Escape must undo the live preview rather than commit it.
      restoreOnCancel
      className="flex h-full min-h-0 w-full flex-col"
    >
      <ReuiKanbanBoard
        className={cn(
          // A horizontal strip of fixed-width lanes: the classic kanban shape.
          // The lanes scroll, each lane's card list scrolls on its own, and the
          // strip itself never grows past the shell's renderer box.
          "flex h-full min-h-0 grid-cols-none items-stretch gap-3 overflow-x-auto overflow-y-hidden p-3",
        )}
      >
        {laneIds.map((laneId) => {
          const lane = laneById.get(laneId);
          if (!lane) return null;
          const cards = columns[laneId] ?? [];
          const collapsed = collapsedLaneIds.includes(laneId);

          if (collapsed) {
            return (
              <KanbanColumn
                key={laneId}
                value={laneId}
                className="flex h-full w-12 shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-muted/40 py-1.5"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={translate("展开泳道：{value1}", {
                    value1: lane.name,
                  })}
                  className="size-6 shrink-0 text-muted-foreground"
                  onClick={() => toggleLane(laneId)}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: lane.color }}
                />
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {cards.length}
                </span>
                <span className="min-h-0 truncate text-xs font-medium [writing-mode:vertical-rl]">
                  {lane.name}
                </span>
              </KanbanColumn>
            );
          }

          return (
            <KanbanColumn
              key={laneId}
              value={laneId}
              className="flex h-full w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/40"
            >
              <LaneHeader
                lane={lane}
                count={cards.length}
                canCreate={Boolean(onCreateCard)}
                canReorderLanes={canReorderLanes && lane.optionId !== null}
                canEditOption={Boolean(onOptionSave) && lane.optionId !== null}
                onToggle={() => toggleLane(laneId)}
                onCreate={() => onCreateCard?.(laneId)}
                onOptionSave={(patch) =>
                  lane.optionId && onOptionSave?.(lane.optionId, patch)
                }
              />
              <KanbanColumnContent
                value={laneId}
                className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
              >
                {cards.map((card) => (
                  <KanbanCardItem
                    key={card.key}
                    card={card}
                    compact={model.settings.compact}
                    draggable={canDragCards}
                    moveTargets={model.lanes.filter(
                      (candidate) => candidate.id !== laneId,
                    )}
                    hiddenFieldIds={hiddenFieldIds}
                    onMove={onCardLaneChange}
                    resolveNode={resolveNode}
                    resolveNodeTitle={resolveNodeTitle}
                    onOpenNode={onOpenNode}
                  />
                ))}
                {cards.length === 0 && (
                  <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border/70 px-2 text-center text-[11px] text-muted-foreground/80">
                    {canDragCards ? t("拖动卡片到此泳道") : t("暂无卡片")}
                  </div>
                )}
              </KanbanColumnContent>
            </KanbanColumn>
          );
        })}
      </ReuiKanbanBoard>

      <KanbanOverlay className="w-72">
        {({ value }) => {
          const card = findCardByKey(columns, value);
          if (!card) return null;
          return (
            <KanbanItem value={card.key}>
              <KanbanCardBody
                card={card}
                compact={model.settings.compact}
                resolveNode={resolveNode}
                resolveNodeTitle={resolveNodeTitle}
                onOpenNode={onOpenNode}
                className="cursor-grabbing shadow-lg"
              />
            </KanbanItem>
          );
        }}
      </KanbanOverlay>
    </Kanban>
  );
}
