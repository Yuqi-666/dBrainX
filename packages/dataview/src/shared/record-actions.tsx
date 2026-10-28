// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The record surface's context — how a view talks to the record page and the
 * record menu without owning either.
 *
 * `DataViewRoot` renders **one** record context menu and provides this context;
 * every view opens a record with `openRecord(rowId)`. That is what makes "click
 * a record" mean the same thing in the table, the kanban, the calendar and the
 * gallery. The record *editing page* is not the shell's: `openRecord` reports
 * the request to the host (`DataViewRoot`'s `onOpenRecord`), and the host
 * node-content renders `<RecordEditor>` — see `shared/record-editor.tsx`.
 *
 * A view may also declare which of its fields the current view does not already
 * surface (`hiddenFieldIds`); those fold into the editor's 隐藏字段 section,
 * exactly like the reference screenshot.
 */
import { createContext, useContext } from "react";
import type { LucideIcon } from "lucide-react";
import type {
  DatabaseCell,
  DatabaseField,
  DataRow,
  DataViewSource,
  NodeId,
} from "@workspace/interfaces";

export interface OpenRecordOptions {
  /**
   * Field ids the calling view does **not** surface (e.g. the table's hidden
   * columns). The editor renders them inside a collapsed 隐藏字段 block, so a
   * record page reads as "this view, plus everything else".
   */
  hiddenFieldIds?: readonly string[];
}

/**
 * One item of the unified record menu.
 *
 * The model lives here (next to the context) rather than in `record-menu.tsx`
 * because the imperative `openRecordMenu` needs it: `record-menu.tsx` imports
 * *this* module, so a type defined there could not be referenced here without a
 * cycle.
 */
export interface RecordMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  disabled?: boolean;
  /** Present → the item opens a submenu instead of firing `onSelect`. */
  items?: RecordMenuItem[];
  onSelect?: () => void;
}

export interface RecordMenuSection {
  id: string;
  /** Optional heading (the table ignores it; a menu ignores it too). */
  label?: string;
  items: RecordMenuItem[];
}

/** The record menu's options: which fields to fold, plus a view's own items. */
export interface RecordMenuOptions extends OpenRecordOptions {
  /** A view's own items, appended after the shared ones. */
  sections?: readonly RecordMenuSection[];
}

export interface RecordActionsContextValue {
  /** The *unfiltered* source: the editor must be able to show any record. */
  source: DataViewSource;
  /** Whether the data may be edited at all (collection projections: false). */
  editable: boolean;
  /** Host callbacks, forwarded unchanged. */
  onCellChange?: (rowId: string, fieldId: string, cell: DatabaseCell) => void;
  onRowInsert?: (row: DataRow, index?: number) => void;
  onRowDelete?: (rowIds: readonly string[]) => void;
  onFieldsChange?: (fields: DatabaseField[], rows?: DataRow[]) => void;
  onOpenNode?: (nodeId: NodeId) => void;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  /** Ask the host to open its record editing page on a row. */
  openRecord: (rowId: string, options?: OpenRecordOptions) => void;
  /**
   * Open the record menu at a viewport point.
   *
   * The declarative `RecordContextMenu` covers every DOM surface that can wrap
   * its record in a React element. A canvas/library-rendered surface cannot
   * (FullCalendar's event element is not a React node, and a right-click on it
   * reaches the element itself, not the content we rendered inside), so those
   * views call this instead — the item list is the same one.
   */
  openRecordMenu: (
    point: { x: number; y: number },
    rowId: string,
    options?: RecordMenuOptions,
  ) => void;
}

const FALLBACK: RecordActionsContextValue = {
  source: { kind: "database", fields: [], rows: [] },
  editable: false,
  openRecord: () => {},
  openRecordMenu: () => {},
};

const RecordActionsContext = createContext<RecordActionsContextValue>(FALLBACK);

export function RecordActionsProvider({
  value,
  children,
}: {
  value: RecordActionsContextValue;
  children: React.ReactNode;
}) {
  return (
    <RecordActionsContext.Provider value={value}>
      {children}
    </RecordActionsContext.Provider>
  );
}

/**
 * The record actions of the enclosing `DataViewRoot`.
 *
 * Outside a root (a bare renderer in isolation) this returns a no-op value
 * rather than throwing, so a view stays renderable on its own — the same
 * tolerance the registry has everywhere else.
 */
export function useRecordActions(): RecordActionsContextValue {
  return useContext(RecordActionsContext);
}
