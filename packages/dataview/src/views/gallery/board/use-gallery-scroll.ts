// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The gallery's scrolling arithmetic.
 *
 * Two shapes, because a card wall has two kinds of "don't render everything":
 *
 * - **网格 / 列表** have one fixed row height per card size, so the visible rows
 *   are a division of `scrollTop` by the row stride — a real virtual window,
 *   with only the visible rows (plus an overscan) mounted.
 * - **瀑布流** is an N-column flow whose cards have natural heights, so there is
 *   no row to divide by. It reveals the next page of cards when a sentinel at
 *   the end of the flow scrolls into view instead; the DOM grows as the user
 *   reads, which is exactly the "don't mount ten thousand cards at once" the
 *   design asks for.
 *
 * Both hooks are measurement-only and dependency-free — the design allows a
 * `react-virtuoso`, but a fixed-height grid needs none of it (gallery.md §2).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { GalleryViewConfig } from "@workspace/interfaces";

import {
  GALLERY_BOARD_PADDING,
  fitColumnCount,
  readRowWindow,
  rowStride,
  totalRowHeight,
} from "../core/layout";

export interface GalleryVirtualWindow {
  startIndex: number;
  endIndex: number;
  /** How far the mounted slice is pushed down inside the spacer. */
  offsetY: number;
  /** Scroll height the spacer claims for every row. */
  totalHeight: number;
}

export interface GalleryScrollState {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  /** Columns the measured width fits (1 while unmeasured / for 列表). */
  columns: number;
  /** Measured size of the scroll container (0 before the first measurement). */
  width: number;
  height: number;
  /** The mounted slice, or `null` when everything is rendered. */
  virtual: GalleryVirtualWindow | null;
}

interface MeasuredViewport {
  width: number;
  height: number;
  scrollTop: number;
}

const EMPTY_VIEWPORT: MeasuredViewport = { width: 0, height: 0, scrollTop: 0 };

/**
 * Measures the scroll container and returns the columns + the mounted slice.
 *
 * State starts empty rather than measured so the server render and the first
 * client render agree; the effect fills it in immediately after mount. With no
 * width yet, {@link fitColumnCount} returns a single column, so the first paint
 * is one full-width card and the measurement then fans it out.
 */
export function useGalleryScroll({
  itemCount,
  layout,
  minColumnWidth,
  rowHeight,
  windowed,
  overscan,
}: {
  itemCount: number;
  layout: GalleryViewConfig["layout"];
  minColumnWidth: number;
  rowHeight: number;
  windowed: boolean;
  overscan?: number;
}): GalleryScrollState {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<MeasuredViewport>(EMPTY_VIEWPORT);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const sync = () =>
      setViewport((previous) => {
        const next: MeasuredViewport = {
          width: element.clientWidth,
          height: element.clientHeight,
          scrollTop: element.scrollTop,
        };
        return previous.width === next.width &&
          previous.height === next.height &&
          previous.scrollTop === next.scrollTop
          ? previous
          : next;
      });

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const { scrollTop } = element;
    setViewport((previous) =>
      previous.scrollTop === scrollTop ? previous : { ...previous, scrollTop },
    );
  }, []);

  const columns =
    layout === "list"
      ? 1
      : fitColumnCount(
          viewport.width - GALLERY_BOARD_PADDING * 2,
          minColumnWidth,
        );

  const virtual = useMemo<GalleryVirtualWindow | null>(() => {
    if (!windowed || itemCount <= 0) return null;
    const rowCount = Math.ceil(itemCount / columns);
    const { firstRow, lastRow } = readRowWindow({
      scrollTop: viewport.scrollTop,
      viewportHeight: viewport.height,
      rowHeight,
      rowCount,
      ...(overscan === undefined ? {} : { overscan }),
    });
    if (lastRow < firstRow) return null;
    return {
      startIndex: firstRow * columns,
      endIndex: Math.min(itemCount, (lastRow + 1) * columns),
      offsetY: firstRow * rowStride(rowHeight),
      totalHeight: totalRowHeight(rowCount, rowHeight),
    };
  }, [
    windowed,
    itemCount,
    columns,
    rowHeight,
    viewport.scrollTop,
    viewport.height,
    overscan,
  ]);

  return {
    scrollRef,
    onScroll,
    columns,
    width: viewport.width,
    height: viewport.height,
    virtual,
  };
}

/** How many cards one reveal adds to a 瀑布流. */
export const GALLERY_REVEAL_PAGE = 40;

export interface GalleryRevealState {
  /** How many cards are currently mounted. */
  count: number;
  /** Callback ref for a zero-height element rendered after the last card. */
  sentinelRef: (node: HTMLDivElement | null) => void;
  /**
   * Reveals at least up to `index`.
   *
   * Incremental reveal is scroll-driven, but keyboard navigation reaches a card
   * *before* any scrolling happens (it asks for the card, then focuses it), so
   * the wall has to be able to reveal a page nobody has scrolled to yet.
   */
  ensureCount: (index: number) => void;
}

/**
 * Incremental reveal for the 瀑布流: mounts one page up front and one more each
 * time the sentinel becomes visible.
 *
 * The sentinel is **conditionally** rendered (it only exists in the 瀑布流
 * branch), so the observer is attached from a callback ref rather than an
 * effect: an effect keyed on the data would have run while the sentinel was
 * still absent — the 网格 branch — and never re-run when the layout switched,
 * leaving the wall frozen at its first page.
 *
 * The sentinel stays mounted once every card is revealed, so the observer is
 * never torn down mid-read; the `current >= total` guard makes its callback a
 * no-op then.
 */
export function useIncrementalReveal({
  enabled,
  total,
  page = GALLERY_REVEAL_PAGE,
}: {
  enabled: boolean;
  total: number;
  page?: number;
}): GalleryRevealState {
  const [revealed, setRevealed] = useState(page);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || !enabled) return;
      if (typeof IntersectionObserver === "undefined") return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          setRevealed((current) =>
            current >= total ? current : Math.min(total, current + page),
          );
        },
        // Start the next page before the sentinel is actually on screen.
        { rootMargin: "600px 0px" },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [enabled, total, page],
  );

  const ensureCount = useCallback(
    (index: number) => {
      setRevealed((current) => Math.max(current, Math.min(total, index + 1)));
    },
    [total],
  );

  return {
    count: enabled ? Math.min(revealed, total) : total,
    sentinelRef,
    ensureCount,
  };
}
