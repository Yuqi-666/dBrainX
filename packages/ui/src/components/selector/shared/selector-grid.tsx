// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useCommandState } from "cmdk";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@workspace/ui/components/ui/command";
import { cn } from "@workspace/ui/lib/utils";

export interface SelectorGridItem {
  /** Stable identity — dedupe key (最近使用 dedupes by `kind:value`). */
  key: string;
  /** Accessible name; also the text `Command` filters on. */
  label: string;
  /** Extra filter terms (emoji names, Lucide keywords). */
  keywords?: string[];
  /** What to draw: an emoji character, `<Icon />`, or an `<img>`. */
  content: ReactNode;
}

export interface SelectorGridProps {
  items: SelectorGridItem[];
  onSelect: (item: SelectorGridItem) => void;
  /** Defaults to the design's 8 columns. */
  columns?: number;
  /** Shown when `items` is empty. */
  emptyState?: ReactNode;
  className?: string;
}

/**
 * `--media-cell` carries the cell size so the track and the cell cannot drift
 * apart: 8 × 36px + 7 × 4px = 316px, i.e. the 320px icon panel minus its 2px
 * body padding (sel §2/§5 尺寸). `pointer-coarse` raises the cell to 44px for
 * touch, and the shell's `width` is a floor, so the panel grows with it instead
 * of clipping. (Both rules were confirmed in the running dev stylesheet, which
 * emits `--media-cell: calc(var(--spacing) * 9 / 11)` inside the
 * `@media (pointer: coarse)` block.)
 */
const CELLS =
  "[--media-cell:--spacing(9)] pointer-coarse:[--media-cell:--spacing(11)]";

export function SelectorGrid({
  items,
  onSelect,
  columns = 8,
  emptyState,
  className,
}: SelectorGridProps): ReactNode {
  const gridRef = useRef<HTMLDivElement>(null);
  /** The one cell that owns the grid's tab stop. */
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /**
   * cmdk hides non-matching items by unmounting them, and it does that inside
   * each `CommandItem` — this component does not re-render on its own. Reading
   * the query here is what lets the effect below notice a new visible set.
   */
  const search = useCommandState((state) => state.search);

  const visibleCells = useCallback((): HTMLElement[] => {
    const root = gridRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("[data-media-key]"));
  }, []);

  // Keep exactly one tab stop. If the active cell was filtered out (or the tab
  // swapped the whole list), the first visible cell takes it over, so the grid
  // never silently drops out of the tab order.
  useEffect(() => {
    const cells = visibleCells();
    if (cells.length === 0) return;
    const keys = cells.map((cell) => cell.dataset.mediaKey ?? "");
    if (!activeKey || !keys.includes(activeKey)) setActiveKey(keys[0] ?? null);
  }, [items, search, activeKey, visibleCells]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cells = visibleCells();
    if (cells.length === 0) return;

    const keys = cells.map((cell) => cell.dataset.mediaKey ?? "");
    const from = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-media-key]",
    );
    const index = Math.max(
      0,
      keys.indexOf(from?.dataset.mediaKey ?? activeKey ?? ""),
    );
    const last = cells.length - 1;
    const rowStart = index - (index % columns);
    const rowEnd = Math.min(rowStart + columns - 1, last);

    let target: number;
    switch (event.key) {
      case "ArrowRight":
        target = Math.min(index + 1, last);
        break;
      case "ArrowLeft":
        target = Math.max(index - 1, 0);
        break;
      case "ArrowDown":
        // Rows do not wrap: stepping past the last row stays put.
        target = index + columns <= last ? index + columns : index;
        break;
      case "ArrowUp":
        target = index - columns >= 0 ? index - columns : index;
        break;
      case "Home":
        target = rowStart;
        break;
      case "End":
        target = rowEnd;
        break;
      case "Enter":
      case " ": {
        // Both keys pick the focused cell directly and stop the event here, so
        // cmdk's root handler (`aria-activedescendant`, which we do not drive)
        // and any native activation cannot fire a second time.
        event.preventDefault();
        const item = items.find(
          (candidate) => candidate.key === cells[index]?.dataset.mediaKey,
        );
        if (item) onSelect(item);
        return;
      }
      default:
        return;
    }

    event.preventDefault();
    const cell = cells[target];
    if (!cell) return;
    cell.focus();
    setActiveKey(keys[target] ?? null);
  };

  if (items.length === 0) {
    return <div className={cn("p-1", className)}>{emptyState}</div>;
  }

  return (
    <>
      <CommandGroup className="p-0">
        <div
          ref={gridRef}
          role="presentation"
          style={{
            gridTemplateColumns: `repeat(${columns}, var(--media-cell))`,
          }}
          className={cn("grid w-fit gap-1 p-0.5", CELLS, className)}
          onKeyDown={handleKeyDown}
        >
          {items.map((item) => {
            const active = item.key === activeKey;
            return (
              <CommandItem
                key={item.key}
                value={item.label}
                keywords={item.keywords}
                data-media-key={item.key}
                data-media-active={active || undefined}
                tabIndex={active ? 0 : -1}
                aria-label={item.label}
                className={cn(
                  "flex items-center justify-center gap-0 rounded-md p-0 text-lg",
                  "size-(--media-cell)",
                  // cmdk's own hover highlight; the keyboard one is `active`.
                  "data-[media-active=true]:bg-muted data-[media-active=true]:text-foreground",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                  // `CommandItem` always appends its `CheckIcon`; a grid cell has
                  // nothing to check, and the spare node would break centering.
                  "[&>svg:last-child]:hidden",
                )}
                onFocus={() => setActiveKey(item.key)}
                onSelect={() => onSelect(item)}
              >
                {item.content}
              </CommandItem>
            );
          })}
        </div>
      </CommandGroup>
      {emptyState ? (
        <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
          {emptyState}
        </CommandEmpty>
      ) : null}
    </>
  );
}
