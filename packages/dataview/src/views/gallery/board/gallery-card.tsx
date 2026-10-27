// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * One gallery card: the shared `DataCard` plus the wall's own interaction layer.
 *
 * The *look* of the card — cover, title, chips, value lines, the 展示模式 — is
 * `shared/card.tsx`, which the kanban draws too; this file only adds what a
 * gallery tile needs on top of it:
 *
 * - a transparent **open** button covering the tile (`z-0`), which is also the
 *   card's tab stop — the element the wall's roving `tabIndex` moves;
 * - the **right-click menu**: the shell's unified record menu
 *   (`RecordContextMenu`), plus this view's own 选择 / 删除选中 items.
 *
 * There is deliberately **no** floating control on the card: no checkbox and no
 * "…" button. The card is a record, so a click opens it and a right-click is the
 * menu; selection is the keyboard / modifier gesture (Space, Ctrl-Cmd-click,
 * Shift-range), and the few things that need a surface live in that menu.
 *
 * Gestures, in the order the card tests them:
 *
 * | gesture                    | result                                    |
 * | -------------------------- | ----------------------------------------- |
 * | click                      | 打开记录 (the shell's record editor)       |
 * | Ctrl/Cmd-click             | add/remove this card from the selection   |
 * | Shift-click                | select the range from the anchor to here  |
 * | right-click                | the record menu at the pointer            |
 * | Enter / Space when focused | 打开记录 / 勾选                            |
 * | arrow keys                 | move between cards (handled by the wall)  |
 */
import { type KeyboardEvent, type MouseEvent } from "react";
import { Check, Trash2 } from "lucide-react";
import type {
  GalleryViewConfig,
  NodeData,
  NodeId,
} from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";

import { DataCard } from "../../../shared/card";
import {
  RecordContextMenu,
  type RecordMenuSection,
} from "../../../shared/record-menu";
import type { GalleryCard } from "../core/schema";

/** The 列表 thumbnail box, sized with the card so the fixed row is not wasted. */
const LIST_THUMBNAIL: Record<GalleryViewConfig["cardSize"], string> = {
  small: "size-11",
  medium: "size-14",
  large: "size-16",
};

/**
 * A Shift range request.
 *
 * `anchor` is only supplied by the keyboard path: a Shift+arrow starts from
 * whatever card had focus, while a Shift-click starts from the last card the
 * user selected one at a time (the wall keeps that anchor itself).
 */
export interface SelectRangeOptions {
  additive: boolean;
  anchor?: GalleryCard;
}

export interface GalleryCardItemProps {
  card: GalleryCard;
  layout: "grid" | "masonry" | "list";
  /** Card size; drives the 列表 thumbnail, whose row height is fixed. */
  size: GalleryViewConfig["cardSize"];
  /** 卡片配置 → 展示模式：紧凑. */
  compact: boolean;
  selected: boolean;
  /** How many cards the selection holds (for the menu's bulk delete). */
  selectedCount: number;
  /** Keyboard focus is on this card (the wall's roving tab stop). */
  active: boolean;
  /** 列表 under a narrow container: the values fold under the title. */
  folded: boolean;
  onOpen: (card: GalleryCard) => void;
  onToggleSelect: (card: GalleryCard) => void;
  /** Shift-click: extends the selection from the anchor to this card. */
  onSelectRange?: (card: GalleryCard, options: SelectRangeOptions) => void;
  /** The card took focus — the wall moves its roving tab stop here. */
  onFocusCard?: (card: GalleryCard) => void;
  /** 删除选中的 N 条 — the bulk action, offered by the card's own menu. */
  onDeleteSelected?: () => void;
  resolveNode?: (nodeId: string) => NodeData | undefined;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  onOpenNode?: (nodeId: NodeId) => void;
  className?: string;
}

export function GalleryCardItem({
  card,
  layout,
  size,
  compact,
  selected,
  selectedCount,
  active,
  folded,
  onOpen,
  onToggleSelect,
  onSelectRange,
  onFocusCard,
  onDeleteSelected,
  resolveNode,
  resolveNodeTitle,
  onOpenNode,
  className,
}: GalleryCardItemProps) {
  const { t } = useI18n();

  /**
   * The card's one gesture entry point. Modifiers are tested first because they
   * all mean "select".
   */
  const handleActivate = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey && onSelectRange) {
      onSelectRange(card, { additive: event.metaKey || event.ctrlKey });
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      onToggleSelect(card);
      return;
    }
    onOpen(card);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(card);
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      // Space would scroll the wall; nothing in the wall's shortcut set uses it.
      event.preventDefault();
      onToggleSelect(card);
    }
  };

  const focusProps = {
    tabIndex: active ? 0 : -1,
    onKeyDown: handleKeyDown,
    onFocus: () => onFocusCard?.(card),
  };

  const openLayer = (
    <button
      type="button"
      aria-label={translate("打开「{value1}」", { value1: card.title })}
      onClick={handleActivate}
      {...focusProps}
      className="absolute inset-0 z-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      data-gallery-open={card.rowId}
      data-gallery-focus={card.rowId}
    />
  );

  /**
   * This view's own menu items — the record's come from the shared builder.
   *
   * There is no 批量操作 toolbar button any more (the function group of a
   * toolbar is for the view's own verbs, and a select-mode switch is not one of
   * them): selection is Ctrl-click / Shift-range / Space / Ctrl+A on the cards
   * themselves, and the one bulk action that needs a surface — deleting the
   * selection — appears on the menu of a card that *is* selected, which is the
   * file-manager convention.
   */
  const sections: RecordMenuSection[] = [
    {
      id: "gallery",
      items: [
        {
          id: "gallery.select",
          label: selected ? t("取消选择") : t("选择"),
          icon: Check,
          onSelect: () => onToggleSelect(card),
        },
        ...(selected && selectedCount > 1 && onDeleteSelected
          ? [
              {
                id: "gallery.deleteSelected",
                label: translate("删除选中的 {value1} 条记录", {
                  value1: selectedCount,
                }),
                icon: Trash2,
                destructive: true,
                onSelect: onDeleteSelected,
              },
            ]
          : []),
      ],
    },
  ];

  /**
   * Engagement lives on the card's own visual box: selection is `--primary`
   * (the user put it there), a plain hover only lifts the border and the
   * shadow, and keyboard focus is the ring — so the three never have to be told
   * apart by colour alone.
   */
  const shellClass = cn(
    "transition-[border-color,box-shadow,background-color] duration-150",
    "group-hover/card:shadow-md group-focus-within/card:shadow-md",
    selected
      ? "border-primary/70 ring-1 ring-primary/40"
      : "border-border group-hover/card:border-ring/40",
    layout === "list" && "group-hover/card:bg-accent/30",
  );

  return (
    <RecordContextMenu
      rowId={card.rowId}
      hiddenFieldIds={card.hiddenFieldIds}
      sections={sections}
    >
      <div
        data-gallery-card={card.rowId}
        data-selected={selected ? "true" : undefined}
        className={cn(
          "group/card relative outline-none",
          // 网格 / 列表 rows are a fixed height (the virtual window divides by
          // it), so the card fills its grid area; 瀑布流 cards size themselves.
          layout !== "masonry" && "h-full",
          className,
        )}
      >
        <DataCard
          layout={layout}
          title={card.title}
          cover={card.cover}
          fields={card.fields}
          compact={compact}
          folded={folded}
          coverClassName={layout === "list" ? LIST_THUMBNAIL[size] : undefined}
          resolveNode={resolveNode}
          resolveNodeTitle={resolveNodeTitle}
          onOpenNode={onOpenNode}
          className={cn(shellClass, layout !== "masonry" && "h-full")}
        >
          {openLayer}
        </DataCard>
      </div>
    </RecordContextMenu>
  );
}
