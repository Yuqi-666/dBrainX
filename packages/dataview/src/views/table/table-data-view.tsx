// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

/**
 * The table data view — a VTable `ListTable` driven through React.
 *
 * The shell follows the same shape as the graph package's `ForceGraph`: React
 * owns nothing but a container `<div>` and the view-level UI state, while the
 * imperative table instance is created once per structural config change and
 * released on unmount (table.md §7). Records are pushed with `setRecords`
 * rather than by rebuilding the instance, so editing does not reset scroll or
 * sort.
 *
 * Rendering never writes: every edit is reported through `onCellChange`, view
 * config changes through `onConfigChange`, schema changes through
 * `onFieldsChange`, and row insert/delete through the row callbacks. The host
 * node-content decides how to persist (README §3.4).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Plus, Table2 } from "lucide-react";
import { ListTable, TYPES } from "@visactor/vtable";
import type {
  ColumnDefine,
  ListTableConstructorOptions,
} from "@visactor/vtable";
import { SearchComponent } from "@visactor/vtable-search";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import type {
  DatabaseCell,
  DatabaseField,
  DatabaseFieldOption,
  DataRow,
  TableColumnConfig,
  TableViewConfig,
} from "@workspace/interfaces";

import { DataViewEmptyState } from "../../shared/empty-state";
import {
  resolveCanvasFontFamily,
  useDataViewThemeTokens,
} from "../../shared/theme-tokens";
import { useRecordActions } from "../../shared/record-actions";
import { RECORD_MENU_KEYS, duplicateRow } from "../../shared/record-menu";
import type { DataViewRendererProps } from "../../source/types";
import { createTableEditor } from "./core/editors";
import type { AddFieldAnchor, AddFieldRequest } from "./menus/field-menu";
import { fallbackOptionColor } from "../../shared/field-meta";
import {
  PILL_OPEN_ICON,
  PILL_REMOVE_ICON_PREFIX,
  optionIdsKey,
} from "./canvas/pill";
import {
  TableSelectMenu,
  type SelectMenuAnchor,
  type SelectMenuRequest,
} from "./menus/select-menu";
import {
  applyTableFilters,
  readFilterState,
  sanitizeFilterState,
  type TableFilterState,
} from "./core/filter";
import {
  TABLE_ADD_FIELD_COLUMN_ID,
  TABLE_DENSITY_HEADER_HEIGHT,
  TABLE_DENSITY_ROW_HEIGHT,
  TABLE_ROW_ID_FIELD,
  buildColorLookup,
  buildTableColumns,
  createDataRowId,
  createDatabaseFieldOptionId,
  effectiveFrozenColumnCount,
  isFieldEditable,
  isSelectField,
  recordValueToCell,
  reorderTableColumns,
  resolveTableColumns,
  rowsToRecords,
  visibleTableColumns,
  type TableColorLookup,
  type TableRecord,
} from "./core/schema";
import { TableToolbar, readGroupConditions } from "./toolbar/toolbar";
import { buildTableTheme } from "./canvas/theme";

/**
 * The square the trailing column's "+" occupies inside its header cell.
 *
 * The column itself is stretched by `autoFillWidth`, so the glyph is centred in
 * it — and the shell anchors the 新增字段 dropdown to that same square instead
 * of to the (much wider) header cell.
 */
const ADD_FIELD_BUTTON_SIZE = 18;

/** Menu keys the column context menu reports back. */
const MENU = {
  sortAsc: "dv_sort_asc",
  sortDesc: "dv_sort_desc",
  hideColumn: "dv_hide_column",
  freezeTo: "dv_freeze_to",
  unfreeze: "dv_unfreeze",
  showAll: "dv_show_all",
  deleteRow: "dv_delete_row",
} as const;

/**
 * What the record editor should fold into 隐藏字段 for this table: every field
 * whose column is currently hidden. The table's own column config is the
 * definition of "surfaced", so `visibleTableColumns` is the only source of
 * truth here (a field with no column config at all is visible).
 */
function recordEditorOptions(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
): { hiddenFieldIds: string[] } {
  const visible = new Set(
    visibleTableColumns(config, fields).map((column) => column.fieldId),
  );
  return {
    hiddenFieldIds: fields
      .filter((field) => !visible.has(field.id))
      .map((field) => field.id),
  };
}

/**
 * The select-ish cell the user activated.
 *
 * It is the cell whose capsules are showing their "×" affordances, so it is
 * also the cell whose column config knows how to repaint it: VTable paints the
 * capsules from the column define, and `updateCellContent(col, row)` is what
 * makes it re-run `customRender` for one cell when this changes.
 */
interface ActiveSelectCell {
  rowId: string;
  fieldId: string;
  col: number;
  row: number;
}

/**
 * The open option dropdown.
 *
 * `ids` is the cell's *working* value for as long as the panel is open: every
 * toggle updates it before the write goes out, so a second click in the same
 * frame cannot toggle against a value the host has not echoed back yet.
 */
interface OpenSelectMenu extends SelectMenuRequest {
  col: number;
  row: number;
  ids: string[];
}

/** Shared empty list, so a closed panel does not re-seed its memo per render. */
const NO_IDS: readonly string[] = [];

/** The option ids a VTable record carries for a select-ish field. */
function recordOptionIds(record: unknown, fieldId: string): string[] {
  const raw = (record as Record<string, unknown> | undefined)?.[
    optionIdsKey(fieldId)
  ];
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asFieldId(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * VTable hands some listeners a `BaseTableAPI`; the instance behind it is the
 * `ListTable` we created, so narrowing is safe and confined to this helper.
 */
function asListTable(table: unknown): ListTable {
  return table as ListTable;
}

/** The record id behind a cell, read from the event or the table itself. */
function rowIdFromArgs(
  table: ListTable,
  args: { col: number; row: number; originData?: unknown },
): string | undefined {
  const record = (args.originData ??
    table.getCellOriginRecord(args.col, args.row)) as
    | Record<string, unknown>
    | undefined;
  return asFieldId(record?.[TABLE_ROW_ID_FIELD]);
}

/**
 * Viewport rect of the column-end "+" that 新增字段 hangs off.
 *
 * The glyph is painted on the canvas, so there is no DOM node to hang a menu
 * trigger off: the header cell's rect (offset by the container's position)
 * stands in for the button, and the menu primitive positions the panel against
 * that invisible trigger. The pointer is the last resort.
 *
 * The rect must be `getCellRelativeRect`, **not** `getCellRect`: the latter is
 * the cell's position in the table's own unscrolled coordinate space, so on a
 * horizontally scrolled table (their normal state — the "+" column is off the
 * right edge until you scroll to it) the anchor stayed a whole `scrollLeft` to
 * the right of the glyph and Radix, obeying its collision padding, parked the
 * panel at the window edge instead of under it. Measured with
 * `scrollLeft = 436`: the glyph sat at x ≈ 890 while the anchor claimed 1317.
 * `getCellRelativeRect` is the same call the 单选/多选 panel anchors with.
 */
function addFieldAnchorFrom(
  container: HTMLElement | null,
  table: ListTable,
  args: {
    col: number;
    row: number;
    event?: MouseEvent | PointerEvent | TouchEvent;
  },
): AddFieldAnchor {
  const cellRect = table.getCellRelativeRect(args.col, args.row);
  const bounds = container?.getBoundingClientRect();
  if (bounds && cellRect) {
    // The glyph is centred in the header cell (`buildAddFieldColumn`), so the
    // anchor is that square, not the whole stretched cell.
    const inset = (size: number) =>
      Math.max(0, size / 2 - ADD_FIELD_BUTTON_SIZE / 2);
    return {
      x: bounds.left + cellRect.left + inset(cellRect.width),
      y: bounds.top + cellRect.top + inset(cellRect.height),
      width: ADD_FIELD_BUTTON_SIZE,
      height: ADD_FIELD_BUTTON_SIZE,
      // The column sits at the far right, so the panel opens leftwards.
      align: "end",
    };
  }
  const event = args.event;
  if (event && "clientX" in event) {
    return { x: event.clientX, y: event.clientY, width: 0, height: 0 };
  }
  return {
    x: bounds?.left ?? 0,
    y: bounds?.top ?? 0,
    width: 0,
    height: 0,
  };
}

/** Viewport rect of a real button the shell asked 新增字段 from. */
function elementAnchorFrom(element: Element): AddFieldAnchor {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** The field a cell belongs to, tolerating events that omit it. */
function fieldIdFromArgs(
  table: ListTable,
  args: { col: number; row: number; field?: unknown },
): string | undefined {
  const fromEvent = asFieldId(args.field);
  if (fromEvent) return fromEvent;
  const define = table.getBodyColumnDefine(args.col, args.row) as
    | { field?: unknown }
    | undefined;
  return asFieldId(define?.field);
}

/**
 * The field behind a visual column, read from the deepest header row.
 *
 * Grouped columns have a group header at level 0 and the field header below it,
 * so the search has to start at the bottom; ungrouped columns answer at level 0.
 */
function headerFieldIdAt(table: ListTable, col: number): string | undefined {
  const levels = Math.max(1, table.columnHeaderLevelCount ?? 1);
  for (let level = levels - 1; level >= 0; level -= 1) {
    const define = table.getHeaderDefine(col, level) as
      | { field?: unknown }
      | undefined;
    const fieldId = asFieldId(define?.field);
    if (fieldId) return fieldId;
  }
  return undefined;
}

/** The field a header or body cell belongs to, resolved either way. */
function fieldIdAt(
  table: ListTable,
  col: number,
  row: number,
): string | undefined {
  const fromHeader = headerFieldIdAt(table, col);
  if (fromHeader) return fromHeader;
  const body = table.getBodyColumnDefine(col, row) as
    | { field?: unknown }
    | undefined;
  return asFieldId(body?.field);
}

/** Row ids currently covered by VTable's selection. */
function selectedRowIds(table: ListTable): string[] {
  const ids = new Set<string>();
  for (const range of table.getSelectedCellRanges() ?? []) {
    for (let row = range.start.row; row <= range.end.row; row += 1) {
      const record = table.getCellOriginRecord(range.start.col, row) as
        | Record<string, unknown>
        | undefined;
      const id = asFieldId(record?.[TABLE_ROW_ID_FIELD]);
      if (id) ids.add(id);
    }
  }
  return Array.from(ids);
}

/**
 * The record ids in the order the table currently displays them.
 *
 * The first column is tried first, but the row-number series does not always
 * resolve to a record, so the body columns are probed until one does.
 */
function rowIdsInTableOrder(table: ListTable): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let row = 0; row < table.rowCount; row += 1) {
    let record: Record<string, unknown> | undefined;
    for (let col = 0; col < table.colCount && !record; col += 1) {
      const candidate = table.getCellOriginRecord(col, row) as
        | Record<string, unknown>
        | undefined;
      if (candidate && asFieldId(candidate[TABLE_ROW_ID_FIELD])) {
        record = candidate;
      }
    }
    const id = asFieldId(record?.[TABLE_ROW_ID_FIELD]);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** `config.sortState` → VTable's `SortState[]`. */
function toVTableSortState(
  sortState: TableViewConfig["sortState"],
): TYPES.SortState[] {
  return (sortState ?? [])
    .filter((entry) => entry && entry.fieldId)
    .map((entry) => ({ field: entry.fieldId, order: entry.order }));
}

/** VTable's current sort state → `config.sortState`. */
function fromVTableSortState(
  sortState: TYPES.SortState | TYPES.SortState[] | null,
): NonNullable<TableViewConfig["sortState"]> {
  const list = Array.isArray(sortState)
    ? sortState
    : sortState
      ? [sortState]
      : [];
  return list.flatMap((entry) => {
    const order = String(entry.order).toLowerCase();
    if (order !== "asc" && order !== "desc") return [];
    return [{ fieldId: String(entry.field), order: order as "asc" | "desc" }];
  });
}

/**
 * The sort state VTable is given: the grouping levels first (their direction is
 * what orders the group headers), then the user's own multi-column sort.
 */
function buildVTableSortState(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
): TYPES.SortState[] {
  const groupSorts = readGroupConditions(config, fields)
    .filter((condition) => condition.fieldId !== "")
    .map(
      (condition) =>
        ({
          field: condition.fieldId,
          order: condition.order,
        }) as TYPES.SortState,
    );
  const groupFieldIds = new Set(groupSorts.map((entry) => String(entry.field)));
  const userSorts = toVTableSortState(config.sortState).filter(
    (entry) => !groupFieldIds.has(String(entry.field)),
  );
  return [...groupSorts, ...userSorts];
}

/**
 * The identity of a sort state, as a string.
 *
 * `config.sortState` arrives as a fresh array on every host render, so an effect
 * keyed on its identity would re-push an equal sort forever; the serialized form
 * is what makes an equal rewrite a no-op.
 */
function sortStateKey(sortState: readonly TYPES.SortState[]): string {
  return sortState
    .map((entry) => `${String(entry.field)}:${String(entry.order)}`)
    .join("|");
}

/**
 * Reads the visual column order and widths back out of a live table.
 *
 * The header defines are the reliable index: the body column offset shifts when
 * a row-number series is present, and a grouped column answers one header row
 * deeper. Columns the schema does not know (the trailing "+" column) are
 * skipped by construction.
 */
function readColumnLayout(
  table: ListTable,
  config: TableViewConfig,
  fields: readonly DatabaseField[],
): TableColumnConfig[] {
  const resolved = resolveTableColumns(config, fields);
  const known = new Set(resolved.map((column) => column.fieldId));
  const order: string[] = [];
  const widths = new Map<string, number>();

  for (let col = 0; col < table.colCount; col += 1) {
    const fieldId = headerFieldIdAt(table, col);
    if (!fieldId || !known.has(fieldId) || order.includes(fieldId)) continue;
    order.push(fieldId);
    const width = table.getColWidth(col);
    if (Number.isFinite(width) && width > 0) {
      widths.set(fieldId, Math.round(width));
    }
  }

  if (order.length === 0) return resolved;
  return reorderTableColumns(config, fields, order).map((column) =>
    widths.has(column.fieldId)
      ? { ...column, width: widths.get(column.fieldId) }
      : column,
  );
}

/**
 * The trailing column that opens 新增字段 (设计稿 §字段: 表格最后一列).
 *
 * It is a header-only affordance, drawn as a bare "+" glyph: no chip, no
 * background, no border — the header band it sits on is already `muted`, so the
 * glyph is the whole control (`headerStyle.cursor` is what says "clickable").
 * The whole cell, not just the glyph, is the click target the shell listens
 * for. Its body cells stay blank so a field-less column never looks like data,
 * and export blanks it out (`formatExportOutput`).
 */
function buildAddFieldColumn(tokens: {
  mutedForeground: string;
}): ColumnDefine {
  const size = ADD_FIELD_BUTTON_SIZE;
  return {
    field: TABLE_ADD_FIELD_COLUMN_ID,
    title: "",
    width: 44,
    minWidth: 40,
    sort: false,
    showSort: false,
    dragHeader: false,
    disableColumnResize: true,
    headerStyle: {
      textAlign: "center" as const,
      cursor: "pointer",
    },
    headerCustomRender: (args: {
      rect: { width: number; height: number };
    }) => ({
      renderDefault: false,
      elements: [
        {
          type: "text",
          x: Math.max(0, (args.rect?.width ?? size) / 2),
          y: Math.max(0, (args.rect?.height ?? size) / 2),
          text: "+",
          fill: tokens.mutedForeground,
          fontSize: 13,
          textAlign: "center",
          textBaseline: "middle",
        },
      ],
    }),
    style: { textAlign: "center" as const },
    fieldFormat: () => "",
  } as unknown as ColumnDefine;
}

/** The state a `[recreate]` effect keys off — everything but data and sort. */
function tableStructureKey(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  readOnly: boolean | undefined,
  canEditFields: boolean,
): string {
  return JSON.stringify({
    readOnly: Boolean(readOnly),
    canEditFields,
    fields: fields.map(
      (field) =>
        `${field.id}\u0001${field.name}\u0001${field.type}\u0001${(
          field.options ?? []
        )
          .map((option) => `${option.id}=${option.name}=${option.color ?? ""}`)
          .join(",")}`,
    ),
    columns: resolveTableColumns(config, fields).map((column) => ({
      fieldId: column.fieldId,
      visible: column.visible,
      width: column.width,
      cellTypeOverride: column.cellTypeOverride,
      emptyText: column.format?.emptyText,
    })),
    hidden: config.hiddenFieldIds ?? [],
    groups: (config.columnGroups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      fieldIds: group.fieldIds,
    })),
    colors: config.colorRules ?? [],
    editable: config.editable,
    selectable: config.selectable,
    sortable: config.sortable,
    resizable: config.resizable,
    reorderable: config.reorderable,
    groupable: config.groupable,
    density: config.density,
    frozen: config.frozenColumnCount,
    showRowNumber: config.showRowNumber,
    groupBy: config.groupBy ?? [],
  });
}

export function TableDataView({
  source,
  config,
  readOnly,
  onCellChange,
  onOpenNode,
  onConfigChange,
  onRowInsert,
  onRowDelete,
  onRowReorder,
  onFieldsChange,
  resolveNodeTitle,
  className,
}: DataViewRendererProps<TableViewConfig>) {
  const { t } = useI18n();

  const tokens = useDataViewThemeTokens(config.theme);
  /** The shell's record surface: the table opens the editor / menu through it. */
  const recordActions = useRecordActions();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<ListTable | null>(null);
  const searchRef = useRef<SearchComponent | null>(null);
  const sortStateRef = useRef<TYPES.SortState[]>([]);
  /**
   * The sort state the live table was last given.
   *
   * The 排序 menu writes `config.sortState`, but `structureKey` deliberately
   * excludes it (a sort must not rebuild the table), so without an effect that
   * pushes the config into `updateSortState` the menu would persist a sort the
   * table never applies — the panel looked like it worked and the rows never
   * moved.
   */
  const appliedSortRef = useRef<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [tableContentHeight, setTableContentHeight] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMatch, setSearchMatch] = useState({ count: 0, index: -1 });
  /**
   * 新增字段 as an anchored dropdown: the shell (the canvas "+", the
   * empty-state button) hands the 字段配置 menu the rect to hang it off, and the
   * menu owns the editor state from there.
   */
  const [addFieldRequest, setAddFieldRequest] =
    useState<AddFieldRequest | null>(null);

  const filters = useMemo(
    () =>
      sanitizeFilterState(readFilterState(config.filterState), source.fields),
    [config.filterState, source.fields],
  );

  const records = useLocaleMemo(
    () => rowsToRecords(source, { resolveNodeTitle }),
    [source, resolveNodeTitle],
  );

  const filteredRecords = useMemo(
    () => applyTableFilters(records, filters, source.fields),
    [records, filters, source.fields],
  );

  /** 填色 evaluated once per record set, not per painted cell. */
  const colorLookup = useMemo(
    () => buildColorLookup(filteredRecords, config.colorRules, source.fields),
    [filteredRecords, config.colorRules, source.fields],
  );

  /**
   * The canvas font 单选 / 多选 capsules are measured with.
   *
   * VTable paints on a canvas, so the capsule renderer cannot inherit the
   * surrounding CSS; the resolved stack (and the theme's 12px body size) is
   * handed down instead.
   */
  const pillFont = useMemo(
    () => ({ family: resolveCanvasFontFamily(tokens), size: tokens.fontSize }),
    [tokens],
  );

  const columns = useLocaleMemo(
    () => visibleTableColumns(config, source.fields),
    [config, source.fields],
  );

  /**
   * Schema writes need both halves: the host must accept field changes
   * (`onFieldsChange`) and view-management writes (`onConfigChange`), because
   * adding a field also adds its column config.
   */
  const canEditFields =
    Boolean(onFieldsChange) && Boolean(onConfigChange) && !readOnly;

  /**
   * Opens the 新增字段 dropdown anchored at the control that asked for it.
   *
   * The request is a fresh object every time, so pressing the same button twice
   * re-opens the panel after it was dismissed.
   */
  const clearAddFieldRequest = useCallback(() => {
    setAddFieldRequest(null);
  }, []);

  const requestAddField = useCallback((anchor: AddFieldAnchor) => {
    setAddFieldRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      anchor,
    }));
  }, []);

  /**
   * The activated capsule cell. Canvas-only state: the pills' "×" and the
   * chevron are painted by `customRender`, which reads it through
   * {@link isSelectCellActive}, and every change repaints just the two affected
   * cells — the React tree (and the toolbar) does not re-render at all.
   */
  const activeSelectRef = useRef<ActiveSelectCell | null>(null);

  /**
   * The open option dropdown.
   *
   * Kept both as state (the panel renders from it) and as a ref (a gesture reads
   * the *current* value without being re-created on every keystroke).
   */
  const [selectMenu, setSelectMenu] = useState<OpenSelectMenu | null>(null);
  const selectMenuRef = useRef<OpenSelectMenu | null>(null);

  const updateSelectMenu = useCallback((next: OpenSelectMenu | null) => {
    selectMenuRef.current = next;
    setSelectMenu(next);
  }, []);

  /** Whether a select-ish cell is the activated one — read by `customRender`. */
  const isSelectCellActive = useCallback((fieldId: string, rowId: string) => {
    const active = activeSelectRef.current;
    return active?.fieldId === fieldId && active.rowId === rowId;
  }, []);

  /** Activates a capsule cell (or clears it), repainting both cells involved. */
  const setActiveSelectCell = useCallback((next: ActiveSelectCell | null) => {
    const previous = activeSelectRef.current;
    if (
      previous?.rowId === next?.rowId &&
      previous?.fieldId === next?.fieldId &&
      previous?.col === next?.col &&
      previous?.row === next?.row
    ) {
      return;
    }
    activeSelectRef.current = next;
    const table = tableRef.current;
    if (!table) return;
    if (previous) table.updateCellContent(previous.col, previous.row);
    if (next) table.updateCellContent(next.col, next.row);
  }, []);

  /** The field behind a cell, when it is one this view can edit as options. */
  const editableSelectFieldAt = useCallback(
    (table: ListTable, col: number, row: number) => {
      const fieldId = fieldIdAt(table, col, row);
      const field = fieldId
        ? latest.current.source.fields.find((entry) => entry.id === fieldId)
        : undefined;
      if (!fieldId || !field || !isSelectField(field)) return undefined;
      if (
        !isFieldEditable(field, latest.current.config, latest.current.readOnly)
      ) {
        return undefined;
      }
      return { field, fieldId };
    },
    [],
  );

  /** Opens the option dropdown for a body cell, anchored under it. */
  const openSelectMenu = useCallback(
    (table: ListTable, col: number, row: number) => {
      const target = editableSelectFieldAt(table, col, row);
      const rowId = rowIdFromArgs(table, { col, row });
      if (!target || !rowId) return;
      // Relative (not absolute) coordinates: the anchor has to be where the cell
      // is on screen, and the body scrolls under the header.
      const rect = table.getCellRelativeRect(col, row);
      const bounds = containerRef.current?.getBoundingClientRect();
      const anchor: SelectMenuAnchor = {
        x: (bounds?.left ?? 0) + rect.left,
        y: (bounds?.top ?? 0) + rect.top,
        width: rect.width,
        height: rect.height,
      };
      const current = selectMenuRef.current;
      updateSelectMenu({
        id: (current?.id ?? 0) + 1,
        rowId,
        fieldId: target.fieldId,
        col,
        row,
        anchor,
        ids: recordOptionIds(
          table.getCellOriginRecord(col, row),
          target.fieldId,
        ),
      });
    },
    [editableSelectFieldAt, updateSelectMenu],
  );

  const closeSelectMenu = useCallback(() => {
    updateSelectMenu(null);
  }, [updateSelectMenu]);

  /** Reports one cell write for a select-ish field. */
  const writeSelectCell = useCallback(
    (field: DatabaseField, rowId: string, ids: readonly string[]) => {
      const cell: DatabaseCell =
        field.type === "select"
          ? { type: "select", optionId: ids[0] ?? null }
          : { type: "multiSelect", optionIds: [...ids] };
      latest.current.onCellChange?.(rowId, field.id, cell);
    },
    [],
  );

  /**
   * A pick in the dropdown: 多选 toggles and stays open, 单选 sets and closes.
   */
  const handleSelectOption = useCallback(
    (optionId: string) => {
      const open = selectMenuRef.current;
      if (!open) return;
      const field = latest.current.source.fields.find(
        (entry) => entry.id === open.fieldId,
      );
      if (!field) return;
      const multi = field.type === "multiSelect";
      const ids = multi
        ? open.ids.includes(optionId)
          ? open.ids.filter((id) => id !== optionId)
          : [...open.ids, optionId]
        : [optionId];
      writeSelectCell(field, open.rowId, ids);
      updateSelectMenu(multi ? { ...open, ids } : null);
    },
    [updateSelectMenu, writeSelectCell],
  );

  /**
   * 查找或创建选项: the typed name becomes a new option of the field *and* the
   * cell's value.
   *
   * Two writes go out, in this order on purpose. The host merges the patches of
   * one gesture into a single upsert and the later `rows` patch wins, so the
   * schema half has to be reported first — and the domain rejects a cell that
   * references an option its field does not declare, which is exactly what the
   * intermediate state would be if it were the other way round.
   */
  const handleCreateOption = useCallback(
    (name: string) => {
      const open = selectMenuRef.current;
      if (!open) return;
      const current = latest.current;
      const field = current.source.fields.find(
        (entry) => entry.id === open.fieldId,
      );
      if (
        !field ||
        current.readOnly ||
        !current.onFieldsChange ||
        !current.onConfigChange
      ) {
        return;
      }
      const option: DatabaseFieldOption = {
        id: createDatabaseFieldOptionId(),
        name,
        color: fallbackOptionColor(field.options?.length ?? 0),
      };
      current.onFieldsChange(
        current.source.fields.map((entry) =>
          entry.id === field.id
            ? { ...entry, options: [...(entry.options ?? []), option] }
            : entry,
        ),
      );
      const multi = field.type === "multiSelect";
      const ids = multi ? [...open.ids, option.id] : [option.id];
      writeSelectCell(field, open.rowId, ids);
      updateSelectMenu(multi ? { ...open, ids } : null);
    },
    [updateSelectMenu, writeSelectCell],
  );

  /**
   * The "×" inside a capsule: drop that one option from the cell.
   *
   * The ids come from the VTable record rather than from `source`, because the
   * record is what the painted capsules were built from.
   */
  const removeSelectOption = useCallback(
    (table: ListTable, col: number, row: number, optionId: string) => {
      const target = editableSelectFieldAt(table, col, row);
      const rowId = rowIdFromArgs(table, { col, row });
      if (!target || !rowId) return;
      const ids = recordOptionIds(
        table.getCellOriginRecord(col, row),
        target.fieldId,
      ).filter((id) => id !== optionId);
      writeSelectCell(target.field, rowId, ids);
      const open = selectMenuRef.current;
      if (open && open.rowId === rowId && open.fieldId === target.fieldId) {
        updateSelectMenu({ ...open, ids });
      }
    },
    [editableSelectFieldAt, updateSelectMenu, writeSelectCell],
  );

  const structureKey = useMemo(
    () => tableStructureKey(config, source.fields, readOnly, canEditFields),
    [config, source.fields, readOnly, canEditFields],
  );

  /** The sort the current config asks for, as the effect's stable key. */
  const sortKey = useMemo(
    () => sortStateKey(buildVTableSortState(config, source.fields)),
    [config, source.fields],
  );

  /**
   * Latest values for the VTable listeners, which are attached once per table
   * instance and would otherwise close over the render that created them.
   */
  const latest = useRef({
    config,
    source,
    readOnly,
    filters,
    colorLookup,
    canEditFields,
    resolveNodeTitle,
    onCellChange,
    onOpenNode,
    onConfigChange,
    onRowInsert,
    onRowDelete,
    onRowReorder,
    onFieldsChange,
    requestAddField,
    recordActions,
  });
  useEffect(() => {
    latest.current = {
      config,
      source,
      readOnly,
      filters,
      colorLookup,
      canEditFields,
      resolveNodeTitle,
      onCellChange,
      onOpenNode,
      onConfigChange,
      onRowInsert,
      onRowDelete,
      onRowReorder,
      onFieldsChange,
      requestAddField,
      recordActions,
    };
  });

  const patchConfig = useCallback((patch: Partial<TableViewConfig>) => {
    const current = latest.current.config;
    latest.current.onConfigChange?.({
      ...current,
      ...patch,
    } as TableViewConfig);
  }, []);

  /** The records VTable currently owns, so a rejected edit can be reverted. */
  const filteredRecordsRef = useRef<TableRecord[]>([]);
  useEffect(() => {
    filteredRecordsRef.current = filteredRecords;
  }, [filteredRecords]);

  /** Re-pushes the records VTable owns, undoing a rejected in-place edit. */
  const restoreRecords = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    table.setRecords(filteredRecordsRef.current, {
      sortState: sortStateRef.current,
    });
  }, []);

  const buildOptions = useCallback(
    (
      nextConfig: TableViewConfig,
      nextSource: typeof source,
      nextReadOnly: boolean | undefined,
      nextColorLookup: TableColorLookup,
      showAddField: boolean,
      canDeleteRows: boolean,
    ): ListTableConstructorOptions => {
      const density = nextConfig.density;
      const editable = !nextReadOnly && nextConfig.editable;
      const columnsDefine = buildTableColumns({
        config: nextConfig,
        fields: nextSource.fields,
        readOnly: nextReadOnly,
        resolveEditor: createTableEditor,
        interactiveColor: tokens.primary,
        colorLookup: nextColorLookup,
        pillFont,
        isSelectCellActive,
        selectCellChevronColor: tokens.mutedForeground,
      });
      const fieldById = new Map(
        nextSource.fields.map((field) => [field.id, field]),
      );

      const columnMenu = (
        fieldId: string | undefined,
      ): TYPES.MenuListItem[] => {
        if (!fieldId || !fieldById.has(fieldId)) return [];
        return [
          { text: t("升序排列"), menuKey: MENU.sortAsc },
          { text: t("降序排列"), menuKey: MENU.sortDesc },
          { type: "split" },
          { text: t("隐藏该列"), menuKey: MENU.hideColumn },
          { text: t("冻结到此列"), menuKey: MENU.freezeTo },
          { text: t("取消冻结"), menuKey: MENU.unfreeze },
          { type: "split" },
          { text: t("显示全部列"), menuKey: MENU.showAll },
        ];
      };

      /**
       * The body-cell menu: the unified record actions first, then the column
       * menu, then row deletion.
       *
       * The record items are the same ones every other view offers through
       * `shared/record-menu.tsx` — 打开记录 / 打开节点 / 复制记录 / 删除记录 —
       * and they are dispatched by `menuKey` because a VTable menu cannot call a
       * React handler. Row deletion lives here because a selection-driven
       * toolbar button made the toolbar's function group jump: it
       * appeared/disappeared with the selection and its label grew per selected
       * row, dragging every control in that group around on each
       * `selected_changed` event of a drag. A context menu item is always
       * present, so nothing about the toolbar depends on the selection.
       */
      const bodyMenu = (
        table: ListTable,
        fieldId: string | undefined,
        col: number,
        row: number,
      ): TYPES.MenuListItem[] => {
        const clicked = rowIdFromArgs(table, { col, row });
        if (!clicked) return columnMenu(fieldId);
        const actions = latest.current.recordActions;
        const isCollection = latest.current.source.kind === "collection";

        const items: TYPES.MenuListItem[] = [
          { text: t("打开记录"), menuKey: RECORD_MENU_KEYS.open },
        ];
        if (isCollection && actions.onOpenNode) {
          items.push({
            text: t("打开节点"),
            menuKey: RECORD_MENU_KEYS.openNode,
          });
        }
        if (!latest.current.readOnly && actions.onRowInsert) {
          items.push({
            text: t("复制记录"),
            menuKey: RECORD_MENU_KEYS.duplicate,
          });
        }

        const columnItems = columnMenu(fieldId);
        if (columnItems.length > 0) {
          items.push({ type: "split" }, ...columnItems);
        }

        if (!canDeleteRows) return items;
        // Right-clicking inside a multi-row selection acts on the whole
        // selection; anywhere else deletes just the row under the cursor.
        const selected = selectedRowIds(table);
        const count = selected.includes(clicked) ? selected.length : 1;
        items.push(
          { type: "split" },
          {
            text:
              count > 1
                ? translate("删除选中的 {value1} 行", { value1: count })
                : t("删除此行"),
            menuKey: MENU.deleteRow,
          },
        );
        return items;
      };

      const groupBy = (nextConfig.groupBy ?? []).filter((fieldId) =>
        fieldById.has(fieldId),
      );

      if (showAddField) columnsDefine.push(buildAddFieldColumn(tokens));

      return {
        container: containerRef.current,
        records: [],
        columns: columnsDefine,
        widthMode: "standard",
        // `standard` (not `adaptive`) is deliberate: `adaptive` re-computes row
        // heights to fill the container, which stretches four rows across the
        // whole pane. With `standard` the configured density is respected and
        // the table still fills the pane once the rows are taller than it.
        heightMode: "standard",
        autoFillWidth: true,
        defaultRowHeight: TABLE_DENSITY_ROW_HEIGHT[density],
        defaultHeaderRowHeight: TABLE_DENSITY_HEADER_HEIGHT[density],
        defaultColWidth: 140,
        frozenColCount: effectiveFrozenColumnCount(
          nextConfig,
          nextSource.fields,
        ),
        theme: buildTableTheme(tokens),
        ...(groupBy.length > 0 ? { groupBy } : {}),
        ...(nextConfig.showRowNumber
          ? {
              rowSeriesNumber: {
                title: "#",
                // Wide enough for the drag handle the reorder mode draws in
                // the same cell, plus a two-digit number.
                width: 56,
                dragOrder: nextConfig.reorderable,
                style: {
                  color: tokens.mutedForeground,
                  bgColor: tokens.muted,
                  padding: [7, 2],
                },
                headerStyle: { bgColor: tokens.muted },
              },
            }
          : {}),
        sortState: buildVTableSortState(nextConfig, nextSource.fields),
        multipleSort: true,
        ...(editable
          ? { editCellTrigger: "doubleclick" as const }
          : { editCellTrigger: "api" as const }),
        keyboardOptions: {
          moveFocusCellOnTab: true,
          editCellOnEnter: true,
          selectAllOnCtrlA: true,
          copySelected: true,
          moveSelectedCellOnArrowKeys: true,
          ctrlMultiSelect: true,
          shiftMultiSelect: true,
        },
        select: {
          highlightMode: nextConfig.selectable ? "row" : "cell",
          disableSelect: !nextConfig.selectable,
          headerSelectMode: "inline",
          blankAreaClickDeselect: true,
        },
        hover: { highlightMode: "row" },
        tooltip: {
          isShowOverflowTextTooltip: true,
          renderMode: "html",
          confine: true,
        },
        resize: {
          columnResizeMode: nextConfig.resizable ? "header" : "none",
          rowResizeMode: "none",
        },
        dragOrder: {
          dragHeaderMode: nextConfig.reorderable ? "all" : "none",
        },
        // Right-clicking inside a multi-row selection deletes the selection,
        // so the menu needs the selected cells reported alongside the target.
        eventOptions: { contextmenuReturnAllSelectedCells: true },
        menu: {
          renderMode: "html",
          contextMenuItems: (field, row, col, table) => {
            const listTable = table ? asListTable(table) : undefined;
            const fieldId =
              asFieldId(field) ??
              (listTable ? fieldIdAt(listTable, col, row) : undefined);
            if (!listTable) return columnMenu(fieldId);
            return bodyMenu(listTable, fieldId, col, row);
          },
          defaultHeaderMenuItems: (args) =>
            columnMenu(fieldIdAt(asListTable(args.table), args.col, args.row)),
        },
        emptyTip: {
          text: t("暂无数据，点击「添加记录」开始录入"),
        },
      } as ListTableConstructorOptions;
    },
    [isSelectCellActive, pillFont, tokens, t],
  );

  /** Persist the live sort state into the view config (group levels excluded). */
  const persistSortState = useCallback((table: ListTable) => {
    const groupFieldIds = new Set(
      (latest.current.config.groupBy ?? []).filter(Boolean),
    );
    const live = fromVTableSortState(table.sortState ?? null);
    const next = live.filter((entry) => !groupFieldIds.has(entry.fieldId));
    sortStateRef.current = live.map((entry) => ({
      field: entry.fieldId,
      order: entry.order,
    }));
    // The table already holds this state, so record it as applied: the config
    // write that follows must not push the same sort back into the table.
    appliedSortRef.current = sortStateKey(
      buildVTableSortState(
        { ...latest.current.config, sortState: next },
        latest.current.source.fields,
      ),
    );
    latest.current.onConfigChange?.({
      ...latest.current.config,
      sortState: next,
    });
  }, []);

  const attachListeners = useCallback(
    (table: ListTable) => {
      table.on("change_cell_value", (args) => {
        const fieldId = fieldIdFromArgs(table, args);
        const rowId = rowIdFromArgs(table, args);
        const field = fieldId
          ? latest.current.source.fields.find((entry) => entry.id === fieldId)
          : undefined;
        if (!fieldId || !rowId || !field) return;
        if (
          !isFieldEditable(
            field,
            latest.current.config,
            latest.current.readOnly,
          )
        ) {
          restoreRecords();
          return;
        }
        const cell = recordValueToCell(field, args.changedValue);
        if (!cell) {
          // Rejected input (bad number / date / url) never reaches the store;
          // re-stamping the records reverts the canvas instead of leaving the
          // invalid text on screen.
          restoreRecords();
          return;
        }
        latest.current.onCellChange?.(rowId, fieldId, cell);
      });

      table.on("checkbox_state_change", (args) => {
        const fieldId = fieldIdFromArgs(table, args);
        const rowId = rowIdFromArgs(table, args);
        if (!fieldId || !rowId) return;
        const field = latest.current.source.fields.find(
          (entry) => entry.id === fieldId,
        );
        if (!field) return;
        if (
          !isFieldEditable(
            field,
            latest.current.config,
            latest.current.readOnly,
          )
        ) {
          restoreRecords();
          return;
        }
        latest.current.onCellChange?.(rowId, fieldId, {
          type: "checkbox",
          checked: Boolean(args.checked),
        });
      });

      table.on("click_cell", (args) => {
        const fieldId = fieldIdFromArgs(table, args);

        // The trailing "+" opens the 新增字段 dropdown, anchored to the glyph the
        // user pressed. VTable's inline header select would also select the
        // column's rows on the way in, so the affordance clears the selection it
        // never meant to make.
        if (
          fieldId === TABLE_ADD_FIELD_COLUMN_ID &&
          args.cellLocation === "columnHeader"
        ) {
          table.clearSelected();
          latest.current.requestAddField(
            addFieldAnchorFrom(containerRef.current, table, args),
          );
          return;
        }

        if (args.cellLocation !== "body") {
          setActiveSelectCell(null);
          closeSelectMenu();
          return;
        }
        // A tap on a capsule's "×" or on the cell's chevron is a custom-render
        // icon: it arrives here first (VTable reports it through `targetIcon`)
        // and then again as `icon_click`, which owns the behaviour.
        if (args.targetIcon) return;

        if (!fieldId) {
          setActiveSelectCell(null);
          return;
        }
        const field = latest.current.source.fields.find(
          (entry) => entry.id === fieldId,
        );

        /**
         * 单选 / 多选 cells are capsules with their own gesture:
         *
         * - a click on a cell that is not the activated one activates it — the
         *   capsules gain their "×" and the cell gains its chevron;
         * - a click on the activated cell (or on its chevron) opens the option
         *   dropdown.
         *
         * Every other cell deactivates whatever was active, so the "×" never
         * lingers on a cell the user has moved on from.
         */
        if (field && isSelectField(field)) {
          if (
            isFieldEditable(
              field,
              latest.current.config,
              latest.current.readOnly,
            )
          ) {
            const rowId = rowIdFromArgs(table, args);
            if (rowId && isSelectCellActive(fieldId, rowId)) {
              openSelectMenu(table, args.col, args.row);
              return;
            }
            if (rowId) {
              setActiveSelectCell({
                rowId,
                fieldId,
                col: args.col,
                row: args.row,
              });
              closeSelectMenu();
              return;
            }
          }
          setActiveSelectCell(null);
          closeSelectMenu();
          return;
        }

        setActiveSelectCell(null);
        closeSelectMenu();
        if (!field || field.type !== "relation") return;
        const rowId = rowIdFromArgs(table, args);
        const cell = rowId
          ? latest.current.source.rows.find((row) => row.id === rowId)?.cells[
              fieldId
            ]
          : undefined;
        const [nodeId] = cell?.type === "relation" ? (cell.nodeIds ?? []) : [];
        if (nodeId) latest.current.onOpenNode?.(nodeId);
      });

      /**
       * The canvas glyphs VTable turns into clickable icons: the "×" a capsule
       * shows while its cell is active, and the chevron that opens the dropdown.
       */
      table.on("icon_click", (args) => {
        const name = args.name;
        if (!name) return;
        if (name.startsWith(PILL_REMOVE_ICON_PREFIX)) {
          removeSelectOption(
            table,
            args.col,
            args.row,
            name.slice(PILL_REMOVE_ICON_PREFIX.length),
          );
          return;
        }
        if (name === PILL_OPEN_ICON) openSelectMenu(table, args.col, args.row);
      });

      /**
       * The panel is anchored to where the cell was when it opened, and Radix
       * cannot follow a scroll that happens *inside* VTable's canvas — so a user
       * scroll dismisses it. Only gestures qualify: VTable fires `scroll` for its
       * own bookkeeping too (the `setRecords` after a write re-stamps the same
       * position, ten event-less `scroll`s at a time), and closing on those made
       * the 多选 panel vanish after every pick.
       */
      table.on("scroll", (args) => {
        if (args.event) closeSelectMenu();
      });
      table.on("selected_clear", () => {
        setActiveSelectCell(null);
        closeSelectMenu();
      });

      table.on("dblclick_cell", (args) => {
        if (args.cellLocation !== "body") return;
        const rowId = rowIdFromArgs(table, args);
        if (!rowId) return;
        // An editable data cell consumes the double-click to start editing; the
        // row-number cell has nothing to edit, so it opens the record instead —
        // the table's discoverable way into the record editor.
        if (
          !latest.current.readOnly &&
          !table.isSeriesNumber(args.col, args.row)
        ) {
          return;
        }
        latest.current.recordActions.openRecord(
          rowId,
          recordEditorOptions(
            latest.current.config,
            latest.current.source.fields,
          ),
        );
      });

      table.on("after_sort", () => persistSortState(table));

      const persistLayout = () => {
        const layout = readColumnLayout(
          table,
          latest.current.config,
          latest.current.source.fields,
        );
        latest.current.onConfigChange?.({
          ...latest.current.config,
          columns: layout,
        });
      };

      /**
       * Drag-reordering rows only makes sense against the complete row set: a
       * filter hides rows the user cannot see, and reporting a partial order
       * would silently move the hidden ones.
       */
      const persistRowOrder = () => {
        const current = latest.current;
        if (!current.onRowReorder) return;
        if (table.recordsCount !== current.source.rows.length) return;
        const rowIds = rowIdsInTableOrder(table);
        if (rowIds.length !== current.source.rows.length) return;
        current.onRowReorder(rowIds);
      };

      table.on("resize_column_end", persistLayout);
      table.on("change_header_position", (args) => {
        /**
         * VTable reports the drag axis only for programmatic moves; a drag
         * started from the row-number handle arrives with `movingColumnOrRow`
         * unset, so the source column identifies it instead.
         */
        const movedRows =
          args.movingColumnOrRow === "row" ||
          (args.movingColumnOrRow === undefined &&
            table.isSeriesNumber(args.source.col, args.source.row));
        if (movedRows) persistRowOrder();
        else persistLayout();
      });

      // No selection bookkeeping here: the toolbar no longer shows a
      // selection-driven control (the 删除选中 button is gone), so tracking the
      // count in state would only re-render the tree — and shift the function
      // group — on every `selected_changed` event of a drag.

      table.on("dropdown_menu_click", (args) => {
        const fieldId = fieldIdAt(table, args.col, args.row);
        if (!fieldId) return;
        const current = latest.current.config;
        const visibleIds = visibleTableColumns(
          current,
          latest.current.source.fields,
        ).map((column) => column.fieldId);

        switch (args.menuKey) {
          case RECORD_MENU_KEYS.open: {
            const clickedRowId = rowIdFromArgs(table, args);
            if (!clickedRowId) return;
            latest.current.recordActions.openRecord(
              clickedRowId,
              recordEditorOptions(
                latest.current.config,
                latest.current.source.fields,
              ),
            );
            return;
          }
          case RECORD_MENU_KEYS.openNode: {
            const clickedRowId = rowIdFromArgs(table, args);
            if (!clickedRowId) return;
            const index = latest.current.source.rows.findIndex(
              (row) => row.id === clickedRowId,
            );
            const nodeId =
              latest.current.source.nodeIds?.[index] ?? clickedRowId;
            latest.current.onOpenNode?.(nodeId);
            return;
          }
          case RECORD_MENU_KEYS.duplicate: {
            const clickedRowId = rowIdFromArgs(table, args);
            if (!clickedRowId) return;
            const rows = latest.current.source.rows;
            const index = rows.findIndex((row) => row.id === clickedRowId);
            const row = rows[index];
            if (!row) return;
            duplicateRow(
              row,
              (next, at) => latest.current.onRowInsert?.(next, at),
              index,
            );
            return;
          }
          case MENU.deleteRow: {
            const clickedRowId = rowIdFromArgs(table, args);
            if (!clickedRowId) return;
            // Right-clicking inside a multi-row selection acts on the whole
            // selection; right-clicking anywhere else deletes just that row.
            // (The old toolbar button was the only entry point before — it had
            // to go: it appeared with the selection and shifted every control
            // in the toolbar's function group as the selection grew.)
            const selected = selectedRowIds(table);
            const rowIds = selected.includes(clickedRowId)
              ? selected
              : [clickedRowId];
            latest.current.onRowDelete?.(rowIds);
            table.clearSelected();
            return;
          }
          case MENU.sortAsc:
            table.updateSortState({ field: fieldId, order: "asc" });
            persistSortState(table);
            return;
          case MENU.sortDesc:
            table.updateSortState({ field: fieldId, order: "desc" });
            persistSortState(table);
            return;
          case MENU.hideColumn: {
            if (visibleIds.length <= 1) return;
            patchConfig({
              hiddenFieldIds: Array.from(
                new Set([...(current.hiddenFieldIds ?? []), fieldId]),
              ),
            });
            return;
          }
          case MENU.freezeTo: {
            const index = visibleIds.indexOf(fieldId);
            if (index < 0) return;
            patchConfig({ frozenColumnCount: index + 1 });
            return;
          }
          case MENU.unfreeze:
            patchConfig({ frozenColumnCount: 0 });
            return;
          case MENU.showAll:
            patchConfig({ hiddenFieldIds: [] });
            return;
          default:
            return;
        }
      });
    },
    [
      closeSelectMenu,
      isSelectCellActive,
      openSelectMenu,
      patchConfig,
      persistSortState,
      removeSelectOption,
      restoreRecords,
      setActiveSelectCell,
    ],
  );

  // —— create / release the imperative table ——
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const current = latest.current;
    const table = new ListTable(
      container,
      buildOptions(
        current.config,
        current.source,
        current.readOnly,
        current.colorLookup,
        current.canEditFields,
        !current.readOnly &&
          current.config.editable &&
          Boolean(current.onRowDelete),
      ),
    );
    tableRef.current = table;
    sortStateRef.current = buildVTableSortState(
      current.config,
      current.source.fields,
    );
    appliedSortRef.current = sortStateKey(sortStateRef.current);
    attachListeners(table);

    const observer = new ResizeObserver(() => table.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      searchRef.current = null;
      tableRef.current = null;
      // The cell the user activated belonged to the instance being thrown away;
      // its column define (and the "×" it paints) goes with it.
      activeSelectRef.current = null;
      updateSelectMenu(null);
      // VTable leaks canvas/scene-graph state without an explicit release.
      table.release();
    };
  }, [structureKey, buildOptions, attachListeners, updateSelectMenu]);

  // —— data ———
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const autoSort = latest.current.config.autoSort !== false;
    table.setRecords(filteredRecords, {
      // 自动排序 off: keep VTable's own sort state instead of re-stamping ours.
      sortState: autoSort ? sortStateRef.current : undefined,
    });
    setTableContentHeight(table.getAllRowsHeight());
  }, [filteredRecords, structureKey]);

  // —— sort ——
  /**
   * The 排序 menu → the live table.
   *
   * `config.sortState` is the *only* thing the menu writes, and a config change
   * does not rebuild the table (nor should it — that would drop the scroll
   * position and the selection), so the config has to be pushed into VTable
   * explicitly. `updateSortState` does not fire `after_sort`, so this cannot
   * bounce back into `persistSortState`.
   */
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    if (appliedSortRef.current === sortKey) return;
    const next = buildVTableSortState(
      latest.current.config,
      latest.current.source.fields,
    );
    appliedSortRef.current = sortKey;
    sortStateRef.current = next;
    table.updateSortState(next.length > 0 ? next : null, true);
  }, [sortKey]);

  // —— search ——
  const ensureSearch = useCallback((): SearchComponent | null => {
    const table = tableRef.current;
    if (!table) return null;
    if (!searchRef.current) {
      searchRef.current = new SearchComponent({
        table,
        skipHeader: true,
        autoJump: true,
      });
    }
    return searchRef.current;
  }, []);

  useEffect(() => {
    const component = searchRef.current;
    if (!searchQuery.trim()) {
      component?.clear();
      setSearchMatch({ count: 0, index: -1 });
      return;
    }
    const search = ensureSearch();
    // No table to search: the schema went empty (or every column was hidden)
    // while the box was open. Reset the counter rather than leaving the previous
    // table's numbers on screen.
    if (!search) {
      setSearchMatch({ count: 0, index: -1 });
      return;
    }
    const result = search.search(searchQuery);
    setSearchMatch({
      count: result.results.length,
      index: result.results.length > 0 ? result.index : -1,
    });
    // `filteredRecords` is in the deps so a data change re-runs the highlight
    // pass over the freshly rendered cells; `structureKey` covers the table
    // being rebuilt underneath the query.
  }, [searchQuery, filteredRecords, structureKey, ensureSearch]);

  const handleSearchStep = useCallback((direction: 1 | -1) => {
    const search = searchRef.current;
    if (!search) return;
    const result = direction === 1 ? search.next() : search.prev();
    setSearchMatch({
      count: result.results.length,
      index: result.results.length > 0 ? result.index : -1,
    });
  }, []);

  // —— row operations ———
  const handleInsertRow = useCallback(() => {
    const row: DataRow = { id: createDataRowId(), cells: {} };
    latest.current.onRowInsert?.(row);
  }, []);

  // —— export ———
  const handleExport = useCallback(async (format: "csv" | "excel") => {
    const table = tableRef.current;
    if (!table) return;
    const name = `dataview-${Date.now().toString(36)}`;
    // The trailing "+" column is an affordance, not data — blank it out.
    const blankAffordance = {
      formatExportOutput: (info: { col: number; table: unknown }) =>
        fieldIdAt(info.table as ListTable, info.col, 0) ===
        TABLE_ADD_FIELD_COLUMN_ID
          ? ""
          : undefined,
    };
    try {
      const {
        exportVTableToCsv,
        exportVTableToExcel,
        downloadCsv,
        downloadExcel,
      } = await import("@visactor/vtable-export");
      if (format === "csv") {
        const csv = exportVTableToCsv(table, {
          exportAllData: true,
          ...blankAffordance,
        });
        await downloadCsv(csv, `${name}.csv`);
      } else {
        const buffer = await exportVTableToExcel(
          table,
          { ...blankAffordance },
          true,
        );
        await downloadExcel(buffer, `${name}.xlsx`);
      }
    } catch (error) {
      console.error("[TableDataView] Export failed", error);
    }
  }, []);

  const handleFiltersChange = useCallback(
    (next: TableFilterState) => {
      patchConfig({ filterState: next });
    },
    [patchConfig],
  );

  const handleShowAllColumns = useCallback(() => {
    patchConfig({ hiddenFieldIds: [] });
  }, [patchConfig]);

  /** The field the open option dropdown belongs to (absent when it is closed). */
  const selectMenuField = useMemo(
    () =>
      selectMenu
        ? source.fields.find((field) => field.id === selectMenu.fieldId)
        : undefined,
    [selectMenu, source.fields],
  );

  const fieldCount = source.fields.length;
  const noFields = fieldCount === 0;
  const noVisibleColumns = !noFields && columns.length === 0;
  const canInsertRow = !readOnly && Boolean(onRowInsert) && fieldCount > 0;
  const addRowHeight = TABLE_DENSITY_ROW_HEIGHT[config.density];

  return (
    /**
     * `overflow-hidden` is load-bearing, not decoration — see the container's
     * note below. The view fills the pane it is given and never lets its own
     * canvas rounding push a scrollbar onto an ancestor.
     */
    <div
      data-dataview-table
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden",
        className,
      )}
    >
      <TableToolbar
        config={config}
        fields={source.fields}
        rows={source.rows}
        readOnly={readOnly}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchMatchCount={searchMatch.count}
        searchIndex={Math.max(0, searchMatch.index)}
        onSearchStep={handleSearchStep}
        searchOpen={searchOpen}
        onSearchOpenChange={setSearchOpen}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        visibleRowCount={filteredRecords.length}
        totalRowCount={records.length}
        canInsertRow={canInsertRow}
        onInsertRow={handleInsertRow}
        onExport={(format) => {
          void handleExport(format);
        }}
        addFieldRequest={addFieldRequest}
        onAddFieldDismiss={clearAddFieldRequest}
        onConfigChange={onConfigChange}
        onFieldsChange={onFieldsChange}
      />

      {noFields ? (
        <DataViewEmptyState
          icon={Table2}
          title={t("这个数据表还没有字段")}
          description={t("添加第一个字段后，表格就会显示对应的列。")}
          className="flex-1"
        >
          {canEditFields && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(event) =>
                requestAddField(elementAnchorFrom(event.currentTarget))
              }
            >
              <Plus className="size-3.5" />
              {t("新增字段")}{" "}
            </Button>
          )}
        </DataViewEmptyState>
      ) : noVisibleColumns ? (
        <DataViewEmptyState
          icon={Eye}
          title={t("所有列都被隐藏了")}
          description={t("在字段配置里重新显示至少一列。")}
          className="flex-1"
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleShowAllColumns}
          >
            {t("显示全部列")}{" "}
          </Button>
        </DataViewEmptyState>
      ) : (
        /**
         * The VTable box.
         *
         * `overflow-hidden` is a **correctness requirement**, not styling.
         * VTable stamps its own rounded pixel size on the `.vtable` element it
         * creates here (`style.width = parentElement.offsetWidth`), so whenever
         * that parent measures a fractional size — any browser zoom, any HiDPI
         * window, `80vh`-sized dialogs — the child is up to a pixel larger than
         * the box it sits in. With the shell's renderer wrapper being
         * `overflow: auto`, that hairline spill made the wrapper show **both**
         * scrollbars; the scrollbars took 10px off each axis, which shrank this
         * container to 774×579, which re-wrapped the toolbar (its height is a
         * function of the width), which changed the spill again — `.vtable`'s
         * inline size flipped between two values 10px apart, forever, and the
         * toolbar was visibly dragged along with it.
         *
         * Clipping here (and on the view root) keeps the canvas — and the
         * rounded pixel size VTable derives from us — inside the pane. Nothing
         * the table draws needs to escape: HTML menus/tooltips VTable renders
         * are confined to the same box by VTable itself (`confine: true`), and
         * every menu the view owns is a Radix portal on `document.body`.
         */
        <>
          <div
            ref={containerRef}
            data-dataview-table-canvas
            className="min-h-0 w-full shrink overflow-hidden"
            style={{
              height: tableContentHeight ?? "100%",
              maxHeight: canInsertRow ? `calc(100% - ${addRowHeight}px)` : "100%",
            }}
          />
          {canInsertRow && (
            <div
              data-dataview-table-add-row
              className="flex w-full shrink-0 items-center border-t bg-background"
              style={{ height: addRowHeight }}
            >
              <button
                type="button"
                aria-label={t("添加记录")}
                title={t("添加记录")}
                className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                onClick={handleInsertRow}
              >
                <span className="text-[13px] leading-none">+</span>
              </button>
            </div>
          )}
        </>
      )}

      {/**
       * The 单选 / 多选 dropdown. It is a portal, so it lives outside the
       * clipped canvas box while being anchored to the cell inside it.
       */}
      <TableSelectMenu
        request={selectMenu}
        field={selectMenuField}
        selectedIds={selectMenu?.ids ?? NO_IDS}
        canCreateOption={canEditFields && Boolean(config.editable)}
        onDismiss={closeSelectMenu}
        onSelectOption={handleSelectOption}
        onCreateOption={handleCreateOption}
      />
    </div>
  );
}
