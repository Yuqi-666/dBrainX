// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * A kanban card: the shared `DataCard`, and the draggable wrapper around it.
 *
 * The card body is `shared/card.tsx` — the same cover / title / chips / value
 * lines the gallery draws, configured by the same 卡片配置 menu — so a record
 * looks the same on a board and on a card wall. This file only adds the board's
 * own concerns:
 *
 * - **The drag activator is the handle.** `KanbanItem` carries the ARIA
 *   attributes dnd-kit derives from `useSortable` (notably `tabIndex: 0`); the
 *   pointer/keyboard `listeners` live on `KanbanItemHandle`. A press that barely
 *   moves opens the record instead of dragging, and there is **no floating
 *   control on the card** — no "…" button — so the whole body is drag surface
 *   and the record menu is the right-click one (`RecordContextMenu`), exactly
 *   like the gallery's.
 * - **A non-draggable board renders no handle at all** rather than `disabled`,
 *   because ReUI greys a disabled item out — and a read-only collection board
 *   should not look disabled, it simply cannot be dragged.
 *
 * The item's own `tabIndex` is dropped to `-1` so the card has a single tab
 * stop (the handle), which is also the element the keyboard sensor listens on.
 */
import { useRef } from "react";
import { MoveRight } from "lucide-react";
import type { NodeData, NodeId } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";

import { DataCard } from "../../../shared/card";
import {
  RecordContextMenu,
  type RecordMenuSection,
} from "../../../shared/record-menu";
import { useRecordActions } from "../../../shared/record-actions";
import { KanbanItem, KanbanItemHandle } from "../reui/kanban";
import type { KanbanCard, KanbanLane } from "../core/board";

export interface KanbanCardBodyProps {
  card: KanbanCard;
  compact: boolean;
  resolveNode?: (nodeId: string) => NodeData | undefined;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  onOpenNode?: (nodeId: NodeId) => void;
  className?: string;
}

/** The card's content box — also what the drag overlay renders. */
export function KanbanCardBody({
  card,
  compact,
  resolveNode,
  resolveNodeTitle,
  onOpenNode,
  className,
}: KanbanCardBodyProps) {
  useI18n();

  return (
    <DataCard
      layout="board"
      title={card.title}
      cover={card.cover}
      fields={card.fields}
      compact={compact}
      resolveNode={resolveNode}
      resolveNodeTitle={resolveNodeTitle}
      onOpenNode={onOpenNode}
      className={cn("w-full shadow-xs transition-colors", className)}
    />
  );
}

export interface KanbanCardItemProps {
  card: KanbanCard;
  compact: boolean;
  /** Drag is possible (the host allows cell writes and the board is single-valued). */
  draggable: boolean;
  /** Lanes offered by 移动到; empty/absent removes the item. */
  moveTargets?: KanbanLane[];
  /** Fields the board already surfaces → folded into the record editor. */
  hiddenFieldIds?: readonly string[];
  onMove?: (card: KanbanCard, laneId: string) => void;
  resolveNode?: (nodeId: string) => NodeData | undefined;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  onOpenNode?: (nodeId: NodeId) => void;
  /** Overlay sizing, applied by the drag preview. */
  className?: string;
}

export function KanbanCardItem({
  card,
  compact,
  draggable,
  moveTargets,
  hiddenFieldIds,
  onMove,
  resolveNode,
  resolveNodeTitle,
  onOpenNode,
  className,
}: KanbanCardItemProps) {
  const { t } = useI18n();

  const targets = moveTargets ?? [];
  /** The shell's record surface (the card opens it; the menu reads it). */
  const actions = useRecordActions();
  /** Where the last press started, so a drag does not also open the record. */
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  /**
   * The board's own menu items — everything else (打开记录 / 打开节点 / 复制 /
   * 删除) comes from the shared builder, so the card menu, the right-click menu
   * and every other view's menu stay one list (`shared/record-menu.tsx`).
   */
  const sections: RecordMenuSection[] | undefined =
    onMove && targets.length > 0
      ? [
          {
            id: "kanban",
            items: [
              {
                id: "kanban.move",
                label: t("移动到"),
                icon: MoveRight,
                items: targets.map((lane) => ({
                  id: `kanban.move.${lane.id}`,
                  label: lane.name,
                  onSelect: () => onMove(card, lane.id),
                })),
              },
            ],
          },
        ]
      : undefined;

  /**
   * The card body, wrapped in the unified record context menu.
   *
   * The wrapper is *inside* `KanbanItemHandle` on purpose: a Radix
   * `ContextMenuTrigger` needs a native element to clone, and the vendored
   * `KanbanItem` is a plain function component (no `forwardRef`), so hanging the
   * trigger on it would drop the ref Radix composes.
   */
  const body = (
    <RecordContextMenu
      rowId={card.rowId}
      hiddenFieldIds={hiddenFieldIds}
      sections={sections}
    >
      <div
        role="button"
        tabIndex={-1}
        onPointerDown={(event) => {
          pointerStart.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          // A drag ends with a click on the handle; only a press that barely
          // moved counts as "open the record".
          const start = pointerStart.current;
          if (
            start &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
          ) {
            return;
          }
          actions.openRecord(card.rowId, { hiddenFieldIds });
        }}
        className="block w-full cursor-pointer text-left"
      >
        <KanbanCardBody
          card={card}
          compact={compact}
          resolveNode={resolveNode}
          resolveNodeTitle={resolveNodeTitle}
          onOpenNode={onOpenNode}
        />
      </div>
    </RecordContextMenu>
  );

  if (!draggable) {
    return <div className={cn("relative", className)}>{body}</div>;
  }

  return (
    <KanbanItem
      value={card.key}
      // One tab stop per card: the handle below, not the item wrapper.
      tabIndex={-1}
      className={cn("relative", className)}
    >
      <KanbanItemHandle
        tabIndex={0}
        role="button"
        aria-label={translate("拖动卡片：{value1}", { value1: card.title })}
        className="block cursor-grab rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        {body}
      </KanbanItemHandle>
    </KanbanItem>
  );
}
