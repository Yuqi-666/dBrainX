// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The card wall's layout engine.
 *
 * Three shapes, one scroll container:
 *
 * - **网格** — a fixed-height tile per row, in as many columns as fit, mounted
 *   through a virtual window (`use-gallery-scroll.ts`);
 * - **瀑布流** — N independent column stacks whose cards keep their natural
 *   height, revealed a page at a time because there is no row to divide by;
 * - **列表** — the same row window as 网格, one card per row.
 *
 * The container owns its scrolling (the shell's renderer box never scrolls), and
 * the card size decides both the tile height and the minimum column width — the
 * column count is measured from the pane, never configured, so the wall is
 * responsive by construction.
 *
 * **Why 瀑布流 stacks columns instead of using CSS `column-count`.** A multicol
 * container fills column by column, so the second card on screen was the eighth
 * row — the wall read top-to-bottom instead of left-to-right, and "the next
 * card" was never the card beside it, which is also what arrow-key navigation
 * means by next. Handing card *i* to column `i % columns` keeps the wall in
 * reading order at the cost of ragged column bottoms, which is what a masonry
 * looks like anyway.
 */
import { useCallback, useMemo } from "react";
import type {
  GalleryViewConfig,
  NodeData,
  NodeId,
} from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";

import { resolveCardSize, resolveLayout } from "../core/config";
import {
  GALLERY_BOARD_PADDING,
  GALLERY_COLUMN_GAP,
  GALLERY_LIST_COMPACT_WIDTH,
  galleryCardMetrics,
  rowStride,
} from "../core/layout";
import type { GalleryCard } from "../core/schema";
import {
  GalleryCardItem,
  type GalleryCardItemProps,
  type SelectRangeOptions,
} from "./gallery-card";
import { useGalleryFocus } from "./use-gallery-focus";
import { useGalleryScroll, useIncrementalReveal } from "./use-gallery-scroll";

export interface GalleryBoardProps {
  cards: readonly GalleryCard[];
  config: GalleryViewConfig;
  /** 卡片配置 → 展示模式：紧凑, passed straight to the cards. */
  compact: boolean;
  /** Host lookup for a node whose preview becomes a card's cover. */
  resolveNode?: (nodeId: string) => NodeData | undefined;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  onOpenNode?: (nodeId: NodeId) => void;
  selectedIds: ReadonlySet<string>;
  onOpen: (card: GalleryCard) => void;
  onToggleSelect: (card: GalleryCard) => void;
  /** Shift-click / Shift+arrow: select from the anchor to this card. */
  onSelectRange?: (card: GalleryCard, options: SelectRangeOptions) => void;
  /** 删除选中的 N 条, offered by a selected card's own menu. */
  onDeleteSelected?: () => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  className?: string;
}

export function GalleryBoard({
  cards,
  config,
  compact,
  resolveNode,
  resolveNodeTitle,
  onOpenNode,
  selectedIds,
  onOpen,
  onToggleSelect,
  onSelectRange,
  onDeleteSelected,
  onSelectAll,
  onClearSelection,
  className,
}: GalleryBoardProps) {
  const layout = resolveLayout(config.layout);
  const size = resolveCardSize(config.cardSize);
  // Every card of a wall carries the same cover slot (it is a source/config
  // decision, not a per-row one), so one card answers whether the wall draws
  // covers — and a coverless 网格 therefore shrinks its row (see
  // `galleryCardMetrics`).
  const hasCover = cards.some((card) => card.cover !== undefined);
  const metrics = galleryCardMetrics(size, { hasCover, compact });
  const isMasonry = layout === "masonry";
  // 网格 and 列表 both use fixed row heights so the virtual window's division
  // is exact; 瀑布流 cards size themselves inside their column.
  const rowHeight =
    layout === "list" ? metrics.listRowHeight : metrics.gridRowHeight;

  const { scrollRef, onScroll, columns, width, height, virtual } =
    useGalleryScroll({
      itemCount: cards.length,
      layout,
      minColumnWidth: metrics.minColumnWidth,
      rowHeight,
      // A column flow has no row stride to window against.
      windowed: !isMasonry,
    });

  const reveal = useIncrementalReveal({
    enabled: isMasonry,
    total: cards.length,
  });

  const visible = useMemo(() => {
    if (isMasonry) return cards.slice(0, reveal.count);
    if (!virtual) return cards;
    return cards.slice(virtual.startIndex, virtual.endIndex);
  }, [cards, isMasonry, reveal.count, virtual]);

  /** Global index of the first mounted card. */
  const baseIndex = virtual ? virtual.startIndex : 0;

  const rowIds = useMemo(() => cards.map((card) => card.rowId), [cards]);

  const ensureIndexMounted = useCallback(
    (index: number) => {
      if (isMasonry) {
        reveal.ensureCount(index);
        return;
      }
      const element = scrollRef.current;
      if (!element) return;
      const row = Math.floor(index / columns);
      const top = row * rowStride(rowHeight);
      const bottom = top + rowHeight;
      if (top < element.scrollTop) {
        element.scrollTop = top;
      } else if (bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = bottom - element.clientHeight;
      }
    },
    [columns, isMasonry, reveal, rowHeight, scrollRef],
  );

  const focus = useGalleryFocus({
    rowIds,
    columns,
    rowsPerPage: Math.max(1, Math.floor(height / rowStride(rowHeight))),
    selectable: true,
    hasSelection: selectedIds.size > 0,
    scrollRef,
    ensureIndexMounted,
    onExtendTo: (index) => {
      const card = cards[index];
      // The anchor of a Shift+arrow is the card that had focus *before* the
      // move — not the one we are moving to — so the first Shift+arrow from a
      // bare focus selects that card and its neighbour, not just the neighbour.
      const anchor = cards[focus.activeIndex];
      if (card) onSelectRange?.(card, { additive: false, anchor });
    },
    onSelectAll: () => onSelectAll?.(),
    onClearSelection: () => onClearSelection?.(),
  });

  /**
   * Which card holds the wall's single tab stop. It follows the keyboard, and
   * falls back to the first *mounted* card when the active one has been scrolled
   * out of the window — otherwise the wall would briefly have no tab stop at all
   * and Tab would skip it.
   */
  const activeGlobalIndex = Math.min(
    Math.max(focus.activeIndex, baseIndex),
    baseIndex + Math.max(0, visible.length - 1),
  );

  const cardProps = (
    card: GalleryCard,
    index: number,
  ): Omit<GalleryCardItemProps, "layout"> => ({
    card,
    size,
    compact,
    selected: selectedIds.has(card.rowId),
    selectedCount: selectedIds.size,
    active: index === activeGlobalIndex,
    folded: width > 0 && width < GALLERY_LIST_COMPACT_WIDTH,
    onOpen,
    onToggleSelect,
    onSelectRange,
    onDeleteSelected,
    onFocusCard: (focused) => {
      const found = rowIds.indexOf(focused.rowId);
      if (found >= 0) focus.setActiveIndex(found);
    },
    resolveNode,
    resolveNodeTitle,
    onOpenNode,
  });

  const grid = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: GALLERY_COLUMN_GAP,
        gridAutoRows: `${rowHeight}px`,
      }}
    >
      {visible.map((card, index) => (
        <GalleryCardItem
          key={card.rowId}
          layout={layout}
          {...cardProps(card, baseIndex + index)}
        />
      ))}
    </div>
  );

  /**
   * 瀑布流 columns: card *i* to column `i % columns`, each column a plain flex
   * stack. Column heights drift apart as covers differ — the layout's point.
   */
  const masonryColumns = useMemo(() => {
    const buckets: { card: GalleryCard; index: number }[][] = Array.from(
      { length: columns },
      () => [],
    );
    visible.forEach((card, index) => {
      buckets[index % columns]?.push({ card, index });
    });
    return buckets;
  }, [visible, columns]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onKeyDown={focus.onKeyDown}
      data-dataview-gallery-board={layout}
      data-dataview-gallery-columns={columns}
      className={cn("h-full min-h-0 overflow-auto", className)}
      style={{ padding: GALLERY_BOARD_PADDING }}
    >
      {isMasonry ? (
        <>
          <div className="flex items-start" style={{ gap: GALLERY_COLUMN_GAP }}>
            {masonryColumns.map((bucket, columnIndex) => (
              <div
                // Column position is the identity here: a bucket is "whatever
                // is in this slot", so it must not be keyed by a card.
                key={columnIndex}
                className="flex min-w-0 flex-1 flex-col"
                style={{ gap: GALLERY_COLUMN_GAP }}
              >
                {bucket.map(({ card, index }) => (
                  <GalleryCardItem
                    key={card.rowId}
                    layout="masonry"
                    {...cardProps(card, baseIndex + index)}
                  />
                ))}
              </div>
            ))}
          </div>
          {/* Always rendered so the observer binds on mount; harmless once every
              card is already revealed. */}
          <div ref={reveal.sentinelRef} aria-hidden className="h-px w-full" />
        </>
      ) : virtual ? (
        <div className="relative" style={{ height: virtual.totalHeight }}>
          <div
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${virtual.offsetY}px)` }}
          >
            {grid}
          </div>
        </div>
      ) : (
        grid
      )}
    </div>
  );
}
