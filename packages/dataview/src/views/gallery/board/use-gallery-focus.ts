// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * Keyboard navigation for the card wall — one roving tab stop over the wall.
 *
 * A gallery is a two-dimensional list, so the wall is exactly one tab stop
 * (whichever card is active) and the arrow keys move *within* it, the same
 * contract a grid of files or photos has. Everything is expressed as an index
 * into the card list rather than as DOM focus order, because the wall mounts
 * only a slice of its cards (网格/列表 window, 瀑布流 pages): "move down" is
 * `index + columns`, and the hook asks the board to mount the target row before
 * it tries to focus it.
 *
 * Shortcuts: arrows move, Home/End jump to the ends, PageUp/PageDown move by a
 * screen, Enter activates, Space selects (both on the card itself), Shift+arrow
 * extends the selection, Ctrl/Cmd+A selects everything and Escape clears it.
 * Only the arrows this hook actually consumes are `preventDefault`ed, so a
 * focused menu or input above the wall keeps its own key handling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

export interface GalleryFocusOptions {
  /** Row ids in wall order; index → the element carrying `data-gallery-focus`. */
  rowIds: readonly string[];
  /** Columns the wall is currently drawn with (1 for 列表). */
  columns: number;
  /** Rows a PageUp/PageDown moves, from the measured viewport. */
  rowsPerPage: number;
  selectable: boolean;
  hasSelection: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * Makes the card at `index` exist in the DOM: scrolls the virtual window over
   * its row, or reveals its page in 瀑布流. Called repeatedly until it does.
   */
  ensureIndexMounted: (index: number) => void;
  /** Shift+arrow — extends the selection from the anchor to `index`. */
  onExtendTo: (index: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export interface GalleryFocusState {
  activeIndex: number;
  /** Follows a *mouse* focus, so clicking a card moves the tab stop with it. */
  setActiveIndex: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function useGalleryFocus({
  rowIds,
  columns,
  rowsPerPage,
  selectable,
  hasSelection,
  scrollRef,
  ensureIndexMounted,
  onExtendTo,
  onSelectAll,
  onClearSelection,
}: GalleryFocusOptions): GalleryFocusState {
  const [activeIndex, setActiveIndexState] = useState(0);
  /** An index the wall still owes focus to, once its card is mounted. */
  const pendingRef = useRef<number | null>(null);

  const setActiveIndex = useCallback((index: number) => {
    setActiveIndexState(Math.max(0, index));
  }, []);

  const moveTo = useCallback((index: number) => {
    pendingRef.current = index;
    setActiveIndexState(index);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const count = rowIds.length;
      if (count === 0) return;
      const last = count - 1;
      const clamp = (value: number) => Math.max(0, Math.min(last, value));

      let target: number | null = null;
      switch (event.key) {
        case "ArrowRight":
          target = activeIndex + 1;
          break;
        case "ArrowLeft":
          target = activeIndex - 1;
          break;
        case "ArrowDown":
          target = activeIndex + columns;
          break;
        case "ArrowUp":
          target = activeIndex - columns;
          break;
        case "Home":
          target = 0;
          break;
        case "End":
          target = last;
          break;
        case "PageDown":
          target = activeIndex + Math.max(1, rowsPerPage) * columns;
          break;
        case "PageUp":
          target = activeIndex - Math.max(1, rowsPerPage) * columns;
          break;
        default:
          break;
      }

      if (target !== null) {
        event.preventDefault();
        const next = clamp(target);
        if (event.shiftKey && selectable) onExtendTo(next);
        moveTo(next);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        if (!selectable) return;
        event.preventDefault();
        onSelectAll();
        return;
      }

      if (event.key === "Escape" && hasSelection) {
        event.preventDefault();
        onClearSelection();
      }
    },
    [
      activeIndex,
      columns,
      hasSelection,
      moveTo,
      onClearSelection,
      onExtendTo,
      onSelectAll,
      rowIds.length,
      rowsPerPage,
      selectable,
    ],
  );

  /**
   * The focus attempt runs after **every** render rather than on an
   * `activeIndex` change: the target card usually does not exist yet (its row is
   * outside the virtual window), so the first attempt only asks the board to
   * mount it — and that remount re-runs this effect with the same index. Once
   * the card is there, `focus()` scrolls it the rest of the way into view.
   */
  useEffect(() => {
    const index = pendingRef.current;
    if (index === null) return;
    const rowId = rowIds[index];
    const container = scrollRef.current;
    if (!rowId || !container) {
      pendingRef.current = null;
      return;
    }
    const node = container.querySelector<HTMLElement>(
      `[data-gallery-focus="${CSS.escape(rowId)}"]`,
    );
    if (!node) {
      ensureIndexMounted(index);
      return;
    }
    pendingRef.current = null;
    node.focus();
  });

  return { activeIndex, setActiveIndex, onKeyDown };
}
