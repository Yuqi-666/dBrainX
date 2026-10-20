// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gallery geometry — the numbers that turn a card size into a grid, and a
 * scroll position into a slice of cards.
 *
 * Kept pure and separate from the board so the virtual window is plain
 * arithmetic: a tile row is a fixed height per card size, so "which rows are on
 * screen" is a division rather than a measurement of rendered cards.
 */
import type { GalleryViewConfig } from "@workspace/interfaces";

/** Gap between cards, in both axes. */
export const GALLERY_COLUMN_GAP = 12;

/** Padding inside the scroll container, excluded from the fit calculation. */
export const GALLERY_BOARD_PADDING = 12;

/** How many off-screen card rows a window keeps mounted on each side. */
export const GALLERY_WINDOW_OVERSCAN = 3;

export interface GalleryCardMetrics {
  /** Narrowest a tile may get before the responsive column count drops. */
  minColumnWidth: number;
  /** Fixed tile height for 网格; the cover flexes inside it. */
  gridRowHeight: number;
  /** Fixed row height for 列表. */
  listRowHeight: number;
}

const METRICS: Record<GalleryViewConfig["cardSize"], GalleryCardMetrics> = {
  small: { minColumnWidth: 150, gridRowHeight: 200, listRowHeight: 68 },
  medium: { minColumnWidth: 196, gridRowHeight: 252, listRowHeight: 80 },
  large: { minColumnWidth: 256, gridRowHeight: 320, listRowHeight: 96 },
};

/**
 * 网格 row height when the wall draws **no covers at all**.
 *
 * A grid tile's height is normally the cover's: the cover is what flexes inside
 * the fixed row, so with no cover source configured (no cover field resolves, and
 * not a collection) the row is mostly empty space below the text. A coverless
 * card should read like the kanban's coverless card — no reserved cover area —
 * so the row shrinks to the card body itself.
 *
 * The numbers are the body's **worst case** with headroom — a two-line title,
 * chips wrapped onto two lines, two value lines — because the card shell is
 * `overflow-hidden` and a row shorter than its content would clip the last line.
 * `cardSize` does not change the body's own height (it changes the column
 * width), so one value serves 小 / 中 / 大; 紧凑 drops a value line and tightens
 * the padding, hence the shorter one.
 */
const NO_COVER_GRID_ROW_HEIGHT = 156;
const NO_COVER_GRID_ROW_HEIGHT_COMPACT = 124;

export interface GalleryCardMetricsOptions {
  /** The wall draws covers at all; `false` shrinks the 网格 row. Default true. */
  hasCover?: boolean;
  /** 卡片配置 → 展示模式：紧凑. */
  compact?: boolean;
}

export function galleryCardMetrics(
  size: GalleryViewConfig["cardSize"],
  options: GalleryCardMetricsOptions = {},
): GalleryCardMetrics {
  const base = METRICS[size] ?? METRICS.medium;
  if (options.hasCover !== false) return base;
  return {
    ...base,
    gridRowHeight: options.compact
      ? NO_COVER_GRID_ROW_HEIGHT_COMPACT
      : NO_COVER_GRID_ROW_HEIGHT,
  };
}

/**
 * Below this measured width a 列表 row drops its right-hand value column and
 * folds the same values under the title instead: a fixed-height row with 160px
 * of meta and 200px of title is worse than either half alone.
 */
export const GALLERY_LIST_COMPACT_WIDTH = 620;

/**
 * How many columns fit in `availableWidth`.
 *
 * There is no configured column count any more: the card size owns the minimum
 * tile width and the pane owns how many of those fit. Before the container has
 * been measured (`availableWidth <= 0`) a single column is returned, which the
 * first client render keeps until the resize observer reports the real width.
 */
export function fitColumnCount(
  availableWidth: number,
  minColumnWidth: number,
  gap: number = GALLERY_COLUMN_GAP,
): number {
  if (availableWidth <= 0) return 1;
  const fit = Math.floor((availableWidth + gap) / (minColumnWidth + gap));
  return Math.max(1, fit);
}

/** The distance from one card row's top to the next row's top. */
export function rowStride(rowHeight: number): number {
  return rowHeight + GALLERY_COLUMN_GAP;
}

/** Total scrollable height of `rowCount` fixed rows. */
export function totalRowHeight(rowCount: number, rowHeight: number): number {
  if (rowCount <= 0) return 0;
  return rowCount * rowHeight + (rowCount - 1) * GALLERY_COLUMN_GAP;
}

export interface RowWindow {
  firstRow: number;
  /** Inclusive. */
  lastRow: number;
}

/**
 * The visible row range, padded by `overscan` rows on each side.
 *
 * `viewportHeight <= 0` (before measurement) still yields the first rows, so
 * the first client render is a subset of what the server rendered rather than
 * "everything".
 */
export function readRowWindow({
  scrollTop,
  viewportHeight,
  rowHeight,
  rowCount,
  overscan = GALLERY_WINDOW_OVERSCAN,
}: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  rowCount: number;
  overscan?: number;
}): RowWindow {
  if (rowCount <= 0) return { firstRow: 0, lastRow: -1 };
  const stride = rowStride(rowHeight);
  const first = Math.floor(Math.max(0, scrollTop) / stride) - overscan;
  const last = Math.floor((Math.max(0, scrollTop) + viewportHeight) / stride);
  return {
    firstRow: Math.max(0, first),
    lastRow: Math.min(rowCount - 1, Math.max(0, last) + overscan),
  };
}
