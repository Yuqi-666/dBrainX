// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useMemo, useState } from "react";

export interface UseRowSelectionResult {
  selectedIds: ReadonlySet<string>;
  count: number;
  isSelected: (rowId: string) => boolean;
  toggle: (rowId: string, options?: { additive?: boolean }) => void;
  select: (rowIds: readonly string[]) => void;
  selectAll: () => void;
  clear: () => void;
}

/**
 * Row-selection state shared by every view that supports multi-select.
 *
 * Kept local to a view instance on purpose: v1 does not keep view instances
 * alive across switches (README §3.3), so selection is not persisted.
 */
export function useRowSelection(
  rowIds: readonly string[],
): UseRowSelectionResult {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const rowIdSet = useMemo(() => new Set(rowIds), [rowIds]);

  const isSelected = useCallback(
    (rowId: string) => selectedIds.has(rowId),
    [selectedIds],
  );

  const toggle = useCallback(
    (rowId: string, options?: { additive?: boolean }) => {
      setSelectedIds((previous) => {
        const next = options?.additive ? new Set(previous) : new Set<string>();
        if (previous.has(rowId)) {
          next.delete(rowId);
        } else {
          next.add(rowId);
        }
        return next;
      });
    },
    [],
  );

  const select = useCallback((ids: readonly string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(rowIdSet));
  }, [rowIdSet]);

  const clear = useCallback(() => setSelectedIds(new Set<string>()), []);

  return {
    selectedIds,
    count: selectedIds.size,
    isSelected,
    toggle,
    select,
    selectAll,
    clear,
  };
}
