// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The table view's data-transformation layer: `fields` → VTable columns,
 * `rows` → VTable records, and a VTable edit result → a `DatabaseCell`.
 *
 * Everything here is pure and library-light (only *types* come from
 * `@visactor/vtable`), so the mapping rules stay reviewable independently of
 * the imperative `ListTable` shell in `table-data-view.tsx`.
 *
 * See `docs/dataview/table.md` §3.
 */
import type { ColumnDefine, ColumnsDefine } from "@visactor/vtable";
import type {
  DatabaseCell,
  DatabaseField,
  DataViewSource,
  NodeId,
  TableColorRule,
  TableColumnConfig,
  TableColumnGroup,
  TableViewConfig,
} from "@workspace/interfaces";

import { DEFAULT_EMPTY_TEXT, displayText } from "../../../source/cell-resolver";
import { contrastTextColor } from "../../../shared/color";
import { buildOptionPills, optionIdsKey, type PillFont } from "../canvas/pill";

/**
 * Row-level helpers live in `source/` because every view that creates a row
 * needs them; they are re-exported here so the table's existing call sites
 * (`createDataRowId` from the shell and `column-ops`) keep their import path.
 */
export { createDataRowId, emptyCellForField } from "../../../source/row-utils";

/** The hidden record key that carries `DatabaseRow.id` back to the source row. */
export const TABLE_ROW_ID_FIELD = "__rowId";

/**
 * Synthetic trailing column holding the "+" affordance that adds a field.
 *
 * It is a real VTable column (so it gets a header cell at the end of the row)
 * but never a real field: layout reads skip it because its id is not in the
 * field schema.
 */
export const TABLE_ADD_FIELD_COLUMN_ID = "__addField";

/** One VTable record: display scalars keyed by field id, plus the row id. */
export type TableRecord = Record<string, unknown> & {
  [TABLE_ROW_ID_FIELD]: string;
};

/** Row height per density (table.md §4 — `density`). */
export const TABLE_DENSITY_ROW_HEIGHT: Record<
  TableViewConfig["density"],
  number
> = {
  compact: 26,
  comfortable: 34,
  spacious: 46,
};

/** Header row height per density — the header is never shorter than its text. */
export const TABLE_DENSITY_HEADER_HEIGHT: Record<
  TableViewConfig["density"],
  number
> = {
  compact: 30,
  comfortable: 36,
  spacious: 46,
};

/** Context the record builders need from the host. */
export interface TableRecordContext {
  /** Resolves a `relation` node id to its title; falls back to the raw id. */
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
}

// ============================================================================
// Fields → columns
// ============================================================================

/**
 * Self-heals a persisted `config.columns` against the current schema.
 *
 * A column whose field no longer exists (or that is duplicated) is dropped, and
 * a field the config has never seen is appended in schema order — so a field
 * added elsewhere in the node shows up without the config being rewritten
 * (table.md §9 "自愈").
 */
export function resolveTableColumns(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
): TableColumnConfig[] {
  const known = new Set(fields.map((field) => field.id));
  const seen = new Set<string>();
  const resolved: TableColumnConfig[] = [];

  for (const column of config.columns ?? []) {
    if (!known.has(column.fieldId) || seen.has(column.fieldId)) continue;
    seen.add(column.fieldId);
    resolved.push(column);
  }
  for (const field of fields) {
    if (seen.has(field.id)) continue;
    seen.add(field.id);
    resolved.push({ fieldId: field.id, visible: true });
  }
  return resolved;
}

/**
 * A column is visible when its own config says so **and** it is not in the
 * `hiddenFieldIds` shortcut list (which the header context menu writes).
 */
export function isColumnVisible(
  column: TableColumnConfig,
  config: TableViewConfig,
): boolean {
  if (!column.visible) return false;
  return !(config.hiddenFieldIds ?? []).includes(column.fieldId);
}

/** The columns the table actually renders, in config order. */
export function visibleTableColumns(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
): TableColumnConfig[] {
  return resolveTableColumns(config, fields).filter((column) =>
    isColumnVisible(column, config),
  );
}

/** `config.frozenColumnCount` clamped to the number of columns on screen. */
export function effectiveFrozenColumnCount(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
): number {
  const visible = visibleTableColumns(config, fields).length;
  if (visible === 0) return 0;
  return Math.max(0, Math.min(config.frozenColumnCount ?? 0, visible));
}

/** The VTable cell type a field renders as, before any per-column override. */
export function defaultCellTypeForField(field: DatabaseField): string {
  switch (field.type) {
    case "checkbox":
      return "checkbox";
    case "url":
      return "link";
    default:
      return "text";
  }
}

// ============================================================================
// Cells → display scalars
// ============================================================================

/**
 * The date shown and edited in a date cell.
 *
 * The calendar editor uses `YYYY-MM-DD`; slicing the ISO string keeps the day from shifting
 * with the viewer's timezone.
 */
export function cellToDateInputValue(cell: DatabaseCell | undefined): string {
  if (cell?.type !== "date" || !cell.date) return "";
  return cell.date.slice(0, 10);
}

function optionName(
  field: DatabaseField | undefined,
  optionId: string | null,
): string {
  if (!optionId) return "";
  return (
    field?.options?.find((option) => option.id === optionId)?.name ?? optionId
  );
}

/** `select` / `multiSelect` → the option names the user actually sees. */
export function cellToOptionNames(
  cell: DatabaseCell | undefined,
  field: DatabaseField | undefined,
): string[] {
  if (cell?.type === "select") {
    return cell.optionId ? [optionName(field, cell.optionId)] : [];
  }
  if (cell?.type === "multiSelect") {
    return (cell.optionIds ?? []).map((optionId) =>
      optionName(field, optionId),
    );
  }
  return [];
}

/**
 * The scalar a field's cell contributes to a VTable record.
 *
 * Select-ish fields contribute **option names** rather than ids so the canvas
 * shows — and search / export see — the same text the user reads;
 * {@link recordValueToCell} maps a name back to its id for the paths that still
 * write through VTable.
 */
export function cellToRecordValue(
  cell: DatabaseCell | undefined,
  field: DatabaseField,
  context: TableRecordContext = {},
): string | number | boolean {
  switch (field.type) {
    case "text":
      return cell?.type === "text" ? cell.text : "";
    case "number":
      return cell?.type === "number" && cell.number != null ? cell.number : "";
    case "select":
      return optionName(field, cell?.type === "select" ? cell.optionId : null);
    case "multiSelect":
      return cellToOptionNames(cell, field).join(", ");
    case "date":
      return field.includeTime && cell?.type === "date"
        ? (cell.date ?? "")
        : cellToDateInputValue(cell);
    case "checkbox":
      return cell?.type === "checkbox" ? cell.checked : false;
    case "url":
      return cell?.type === "url" && cell.url ? cell.url : "";
    case "relation":
      return displayText(cell, field, context.resolveNodeTitle);
  }
}

/** Every row of a source as VTable records, each carrying `__rowId`. */
export function rowsToRecords(
  source: DataViewSource,
  context: TableRecordContext = {},
): TableRecord[] {
  return source.rows.map((row) => {
    const record = { [TABLE_ROW_ID_FIELD]: row.id } as TableRecord;
    for (const field of source.fields) {
      const cell = row.cells[field.id];
      record[field.id] = cellToRecordValue(cell, field, context);
      // A select-ish cell also carries its raw option ids beside the display
      // names: the capsule renderer needs the ids to resolve each option's
      // colour without guessing from the label (`canvas/pill.ts`).
      const optionIds = cellToOptionIds(cell);
      if (optionIds) record[optionIdsKey(field.id)] = optionIds;
    }
    return record;
  });
}

/** The raw option ids behind a select-ish cell, or `undefined` for other types. */
function cellToOptionIds(cell: DatabaseCell | undefined): string[] | undefined {
  if (cell?.type === "select") return cell.optionId ? [cell.optionId] : [];
  if (cell?.type === "multiSelect") return cell.optionIds ?? [];
  return undefined;
}

// ============================================================================
// Edited values → cells
// ============================================================================

const ISO_8601_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUrl(value: string): boolean {
  try {
    // Mirrors the domain rule (`assertUrl`): anything `new URL` accepts.
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Resolves an edited select text back to an option id (by name, then by id). */
export function optionTextToId(
  field: DatabaseField | undefined,
  text: string,
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const options = field?.options ?? [];
  const byName = options.find((option) => option.name === trimmed);
  if (byName) return byName.id;
  const byId = options.find((option) => option.id === trimmed);
  return byId ? byId.id : null;
}

function optionTextsToIds(
  field: DatabaseField | undefined,
  texts: readonly string[],
): string[] {
  const options = field?.options ?? [];
  const ids: string[] = [];
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    const matched =
      options.find((option) => option.name === trimmed) ??
      options.find((option) => option.id === trimmed);
    // An unrecognised entry is dropped rather than persisted: the domain
    // rejects option ids that miss `options`.
    if (matched && !ids.includes(matched.id)) ids.push(matched.id);
  }
  return ids;
}

/**
 * Turns one edited VTable value back into a `DatabaseCell`.
 *
 * Returns `null` when the edit must be rejected (a non-finite number, a
 * malformed date or url) — the domain value objects throw on those, so the
 * renderer drops the edit instead of surfacing a persistence error
 * (table.md §3.2 "非法输入不进 store").
 */
export function recordValueToCell(
  field: DatabaseField,
  value: unknown,
): DatabaseCell | null {
  switch (field.type) {
    case "text":
      return { type: "text", text: value == null ? "" : String(value) };
    case "number": {
      if (value === "" || value === null || value === undefined) {
        return { type: "number", number: null };
      }
      const parsed = typeof value === "number" ? value : Number(value);
      return isFiniteNumber(parsed) ? { type: "number", number: parsed } : null;
    }
    case "select":
      return {
        type: "select",
        optionId: optionTextToId(field, value == null ? "" : String(value)),
      };
    case "multiSelect": {
      const texts = Array.isArray(value)
        ? value.map((entry) => String(entry))
        : String(value ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
      return { type: "multiSelect", optionIds: optionTextsToIds(field, texts) };
    }
    case "date": {
      const text = value == null ? "" : String(value).trim();
      if (!text) return { type: "date", date: null };
      if (!ISO_8601_DATE.test(text) || Number.isNaN(Date.parse(text))) {
        return null;
      }
      return {
        type: "date",
        date: field.includeTime ? text : text.slice(0, 10),
      };
    }
    case "checkbox":
      return { type: "checkbox", checked: Boolean(value) };
    case "url": {
      const text = value == null ? "" : String(value).trim();
      if (!text) return { type: "url", url: null };
      return isUrl(text) ? { type: "url", url: text } : null;
    }
    case "relation":
      // Relation editing is deferred (table.md §9): the picker depends on a
      // graph overlay, so v1 renders the resolved titles read-only.
      return null;
  }
}

/** `relation` cells are interactive in the body but never edited in place. */
export function isFieldEditable(
  field: DatabaseField,
  config: TableViewConfig,
  readOnly: boolean | undefined,
): boolean {
  if (readOnly || !config.editable) return false;
  return field.type !== "relation";
}

/**
 * Whether a field stores its value as a set of options (单选 / 多选).
 *
 * These are the fields whose cells render capsules and whose editing happens in
 * the option dropdown rather than in a VTable editor, so both the column builder
 * and the event wiring ask this same question.
 */
export function isSelectField(field: Pick<DatabaseField, "type">): boolean {
  return field.type === "select" || field.type === "multiSelect";
}

/**
 * A fresh option id.
 *
 * Used both by 编辑字段 (a new row in 选项内容) and by the select cell's own
 * dropdown, which can mint the option the user just typed — the domain rejects a
 * cell that references an option its field does not declare, so the two paths
 * must agree on the shape.
 */
export function createDatabaseFieldOptionId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `opt_${globalCrypto.randomUUID()}`;
  }
  return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Columns → VTable column defines
// ============================================================================

/** Resolves the in-cell editor (or editor name) a field edits with. */
export type TableEditorResolver = (
  field: DatabaseField,
) => ColumnDefine["editor"] | undefined;

export interface BuildTableColumnsOptions {
  config: TableViewConfig;
  fields: readonly DatabaseField[];
  readOnly?: boolean;
  resolveEditor?: TableEditorResolver;
  /** Placeholder an empty cell shows (table.md §4 — `format.emptyText`). */
  emptyText?: string;
  /**
   * Color for cells that behave like links (url / relation). Supplied by the
   * shell from the active theme tokens — never hardcoded, so the canvas follows
   * the app palette in both modes.
   */
  interactiveColor?: string;
  /** Pre-evaluated 填色 lookups; omitted when the view has no colour rules. */
  colorLookup?: TableColorLookup;
  /**
   * Canvas font used to measure capsule labels (单选 / 多选). Omitted → those
   * cells fall back to plain text.
   */
  pillFont?: PillFont;
  /**
   * Whether a select-ish cell is the one the user activated.
   *
   * The active cell is the only one whose capsules carry their "×" and whose
   * chevron is drawn, so the query is a live ref read in the shell rather than a
   * value baked into the (rebuilt-on-structure-change) column define.
   */
  isSelectCellActive?: (fieldId: string, rowId: string) => boolean;
  /** Colour of the active cell's chevron (the theme's muted foreground). */
  selectCellChevronColor?: string;
}

/**
 * The VTable `style` callback shape this module relies on.
 *
 * `StylePropertyFunctionArg` is not re-exported from the package root, so the
 * two members actually used are described structurally rather than imported.
 */
interface TableStyleArg {
  row: number;
  col: number;
  table: {
    getCellOriginRecord?: (col: number, row: number) => unknown;
  };
  rect: { width: number; height: number };
}

/** The record id behind the cell a style callback is being asked about. */
function styleArgRowId(args: TableStyleArg): string | undefined {
  const record = args.table?.getCellOriginRecord?.(args.col, args.row) as
    | Record<string, unknown>
    | undefined;
  const rowId = record?.[TABLE_ROW_ID_FIELD];
  return typeof rowId === "string" ? rowId : undefined;
}

/**
 * Builds the VTable `columns` array from the view config.
 *
 * Fields render in `config.columns` order, pulled into their group's contiguous
 * block, and a group becomes a `GroupColumnDefine` so VTable draws its shared
 * header. Each field define carries the editability / sortability /
 * resizability / draggability the view config declares plus its conditional
 * background colour and — for 单选 / 多选 — its colour capsules.
 *
 * `width` is only emitted when the config pins one — otherwise VTable falls
 * back to `defaultColWidth`, which keeps columns stable across reloads instead
 * of being recomputed from whatever data is loaded.
 *
 * Column freezing is deliberately *not* expressed here: VTable freezes from the
 * left through the top-level `frozenColCount` option, which the shell derives
 * from `config.frozenColumnCount` with {@link effectiveFrozenColumnCount}.
 */
export function buildTableColumns({
  config,
  fields,
  readOnly,
  resolveEditor,
  emptyText = DEFAULT_EMPTY_TEXT,
  interactiveColor,
  colorLookup,
  pillFont,
  isSelectCellActive,
  selectCellChevronColor,
}: BuildTableColumnsOptions): ColumnsDefine {
  const byId = new Map(fields.map((field) => [field.id, field]));

  const buildFieldDefine = (column: TableColumnConfig): ColumnDefine | null => {
    const field = byId.get(column.fieldId);
    if (!field || !isColumnVisible(column, config)) return null;

    const editable = isFieldEditable(field, config, readOnly);
    const editor = editable ? resolveEditor?.(field) : undefined;
    const cellType = column.cellTypeOverride ?? defaultCellTypeForField(field);
    const isCheckbox = cellType === "checkbox";
    // Keyed off the *field*, not `cellType`: select-ish fields render as `text`
    // (their capsules come from `customRender`, and their editor is the view's
    // own dropdown rather than one of VTable's built-in cell types).
    const isSelectish = isSelectField(field);
    const interactive = field.type === "url" || field.type === "relation";
    const cellEmptyText = column.format?.emptyText ?? emptyText;

    const baseAlign = isCheckbox
      ? ("center" as const)
      : field.type === "number"
        ? ("right" as const)
        : ("left" as const);

    const bgOf = (args: TableStyleArg): string | undefined =>
      colorLookup
        ? resolveCellColor(field.id, styleArgRowId(args), colorLookup)
        : undefined;

    /**
     * Base alignment + link colour + the 填色 background, resolved per cell.
     *
     * A filled cell also gets a contrasting text colour: the fill is a fixed
     * palette swatch while the text colour comes from the active theme, so the
     * pair is only readable if it is derived from the fill.
     */
    const buildStyle = (args: TableStyleArg) => {
      const bgColor = bgOf(args);
      return {
        textAlign: baseAlign,
        ...(bgColor
          ? { bgColor, color: contrastTextColor(bgColor) }
          : interactive && interactiveColor
            ? { color: interactiveColor, cursor: "pointer" }
            : {}),
      };
    };

    /**
     * 单选 / 多选 render as colour capsules instead of plain text.
     *
     * `renderDefault: true` for an empty selection keeps the column's empty-text
     * placeholder (`—`) — the capsule path only takes over when there is at least
     * one option to draw. The one exception is the **active** cell: it keeps the
     * chevron even while empty (that is how a value gets picked in the first
     * place) and still lets the placeholder render underneath it.
     */
    const customRender = (args: TableStyleArg) => {
      if (!pillFont) return { renderDefault: true, elements: [] };
      const record = args.table?.getCellOriginRecord?.(args.col, args.row) as
        | Record<string, unknown>
        | undefined;
      const raw = record?.[optionIdsKey(field.id)];
      const optionIds = Array.isArray(raw)
        ? raw.filter((entry): entry is string => typeof entry === "string")
        : [];
      const rowId = styleArgRowId(args);
      const active = Boolean(
        rowId && isSelectCellActive?.(field.id, rowId) && editable,
      );
      if (optionIds.length === 0 && !active) {
        return { renderDefault: true, elements: [] };
      }
      const { elements } = buildOptionPills({
        field,
        optionIds,
        width: args.rect?.width ?? 0,
        height: args.rect?.height ?? 0,
        font: pillFont,
        removable: active,
        showChevron: active,
        chevronColor: selectCellChevronColor,
      });
      if (optionIds.length === 0) return { renderDefault: true, elements };
      if (elements.length === 0) return { renderDefault: true, elements: [] };
      return { renderDefault: false, elements };
    };

    const define = {
      field: field.id,
      title: field.name || field.id,
      cellType,
      ...(column.width != null ? { width: column.width } : {}),
      sort: config.sortable,
      showSort: config.sortable,
      dragHeader: config.reorderable,
      ...(config.resizable ? {} : { disableColumnResize: true }),
      ...(isCheckbox
        ? {
            // A checkbox column must not run the empty-text placeholder: the
            // format result is the checked state, not a label.
            style: (args: TableStyleArg) => {
              const bgColor = bgOf(args);
              return {
                textAlign: baseAlign,
                ...(bgColor
                  ? { bgColor, color: contrastTextColor(bgColor) }
                  : {}),
              };
            },
            ...(editable ? {} : { disable: true }),
          }
        : {
            fieldFormat: (record: Record<string, unknown>) => {
              const value = record?.[field.id];
              if (value === "" || value === null || value === undefined) {
                return cellEmptyText;
              }
              if (field.type === "date" && field.includeTime) {
                return displayText(
                  { type: "date", date: String(value) },
                  field,
                );
              }
              return value as string | number;
            },
            style: buildStyle,
            ...(isSelectish && pillFont ? { customRender } : {}),
          }),
      ...(editor ? { editor } : {}),
    } as unknown as ColumnDefine;

    return define;
  };

  const defines: ColumnsDefine = [];
  for (const block of buildColumnBlocks(config, fields)) {
    const blockDefines = block.columns
      .map(buildFieldDefine)
      .filter((define): define is ColumnDefine => define !== null);
    if (blockDefines.length === 0) continue;
    if (!block.group) {
      defines.push(...blockDefines);
      continue;
    }
    const groupDefine = {
      title: block.group.name,
      headerStyle: { textAlign: "center" as const },
      columns: blockDefines,
    } as unknown as ColumnDefine;
    defines.push(groupDefine);
  }

  return defines;
}

/**
 * Applies a new visible order to `config.columns`: the visible columns follow
 * `fieldIds`, hidden ones stay in their existing slots.
 */
export function reorderTableColumns(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
  fieldIds: readonly string[],
): TableColumnConfig[] {
  const resolved = resolveTableColumns(config, fields);
  const position = new Map(fieldIds.map((fieldId, index) => [fieldId, index]));
  const reordered = resolved
    .filter((column) => position.has(column.fieldId))
    .sort((a, b) => position.get(a.fieldId)! - position.get(b.fieldId)!);
  let cursor = 0;
  return resolved.map((column) =>
    position.has(column.fieldId) ? reordered[cursor++]! : column,
  );
}

// ============================================================================
// Column groups (字段配置 → 编组)
// ============================================================================

/**
 * The groups that are safe to render: unknown fields and duplicate memberships
 * are dropped (first group wins), and empty groups disappear — so a deleted
 * field or a corrupt persisted blob degrades instead of breaking the table.
 */
export function validColumnGroups(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
): TableColumnGroup[] {
  const known = new Set(fields.map((field) => field.id));
  const claimed = new Set<string>();
  const groups: TableColumnGroup[] = [];

  for (const group of config.columnGroups ?? []) {
    if (!group || typeof group.id !== "string" || group.id === "") continue;
    const memberIds: string[] = [];
    for (const fieldId of group.fieldIds ?? []) {
      if (!known.has(fieldId) || claimed.has(fieldId)) continue;
      claimed.add(fieldId);
      memberIds.push(fieldId);
    }
    if (memberIds.length === 0) continue;
    groups.push({ ...group, fieldIds: memberIds });
  }
  return groups;
}

/**
 * Pulls each group's members together at the position of the group's first
 * member, so a group header always spans a contiguous block.
 *
 * `config.columns` stays the authoritative order — this is a *projection* of it,
 * not a second source of truth.
 */
export function orderColumnsByGroups(
  columns: readonly TableColumnConfig[],
  groups: readonly TableColumnGroup[],
): TableColumnConfig[] {
  if (groups.length === 0) return [...columns];

  const groupIndexOf = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const fieldId of group.fieldIds) {
      if (!groupIndexOf.has(fieldId)) groupIndexOf.set(fieldId, index);
    }
  });

  const emitted = new Set<number>();
  const ordered: TableColumnConfig[] = [];
  for (const column of columns) {
    const groupIndex = groupIndexOf.get(column.fieldId);
    if (groupIndex === undefined) {
      ordered.push(column);
      continue;
    }
    if (emitted.has(groupIndex)) continue;
    emitted.add(groupIndex);
    for (const memberId of groups[groupIndex]!.fieldIds) {
      const member = columns.find((entry) => entry.fieldId === memberId);
      if (member) ordered.push(member);
    }
  }
  return ordered;
}

/** One visual block of the column header: a group (or none) plus its columns. */
export interface TableColumnBlock {
  group?: TableColumnGroup;
  columns: TableColumnConfig[];
}

/** The visible columns arranged into header blocks (groups + standalones). */
export function buildColumnBlocks(
  config: TableViewConfig,
  fields: readonly DatabaseField[],
): TableColumnBlock[] {
  const groups = validColumnGroups(config, fields);
  const ordered = orderColumnsByGroups(
    resolveTableColumns(config, fields),
    groups,
  ).filter((column) => isColumnVisible(column, config));

  const groupIndexOf = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const fieldId of group.fieldIds) {
      if (!groupIndexOf.has(fieldId)) groupIndexOf.set(fieldId, index);
    }
  });

  const blocks: TableColumnBlock[] = [];
  const started = new Set<number>();
  for (const column of ordered) {
    const groupIndex = groupIndexOf.get(column.fieldId);
    if (groupIndex === undefined) {
      blocks.push({ columns: [column] });
      continue;
    }
    if (started.has(groupIndex)) {
      blocks[blocks.length - 1]!.columns.push(column);
      continue;
    }
    started.add(groupIndex);
    blocks.push({ group: groups[groupIndex], columns: [column] });
  }
  return blocks;
}

// ============================================================================
// Conditional colours (填色)
// ============================================================================

/** rowId / `rowId\u0001fieldId` / fieldId → background colour. */
export interface TableColorLookup {
  rowColors: Map<string, string>;
  cellColors: Map<string, string>;
  columnColors: Map<string, string>;
}

export const EMPTY_COLOR_LOOKUP: TableColorLookup = {
  rowColors: new Map(),
  cellColors: new Map(),
  columnColors: new Map(),
};

const CELL_COLOR_SEPARATOR = "\u0001";

export function cellColorKey(rowId: string, fieldId: string): string {
  return `${rowId}${CELL_COLOR_SEPARATOR}${fieldId}`;
}

/**
 * Evaluates the 填色 rules against the records once, producing the three lookup
 * maps the column `style` functions consult.
 *
 * Doing the work up front keeps the per-cell style callback to a record lookup
 * (the VTable guidance is explicit that style callbacks must stay cheap).
 *
 * `target: "column"` paints a field's whole column when at least one row
 * matches its condition — a conditional column highlight, which is what the
 * 填色 menu offers with a single field picker.
 */
export function buildColorLookup(
  records: readonly TableRecord[],
  rules: readonly TableColorRule[] | undefined,
  fields: readonly DatabaseField[],
): TableColorLookup {
  if (!rules || rules.length === 0) return EMPTY_COLOR_LOOKUP;
  const known = new Set(fields.map((field) => field.id));
  const active = rules.filter(
    (rule) => rule && known.has(rule.fieldId) && rule.color,
  );
  if (active.length === 0) return EMPTY_COLOR_LOOKUP;

  const rowColors = new Map<string, string>();
  const cellColors = new Map<string, string>();
  const columnColors = new Map<string, string>();

  for (const rule of active) {
    let columnMatched = false;
    for (const record of records) {
      const rowId = record[TABLE_ROW_ID_FIELD];
      if (typeof rowId !== "string") continue;
      const raw = record[rule.fieldId];
      const text = raw === null || raw === undefined ? "" : String(raw);
      if (!valueMatchesRule(text, rule)) continue;
      columnMatched = true;
      if (rule.target === "row") {
        if (!rowColors.has(rowId)) rowColors.set(rowId, rule.color);
      } else if (rule.target === "cell") {
        const key = cellColorKey(rowId, rule.fieldId);
        if (!cellColors.has(key)) cellColors.set(key, rule.color);
      }
    }
    if (rule.target === "column" && columnMatched) {
      if (!columnColors.has(rule.fieldId)) {
        columnColors.set(rule.fieldId, rule.color);
      }
    }
  }

  return { rowColors, cellColors, columnColors };
}

function valueMatchesRule(text: string, rule: TableColorRule): boolean {
  const trimmed = (rule.value ?? "").trim();
  switch (rule.operator) {
    case "empty":
      return text.trim() === "";
    case "notEmpty":
      return text.trim() !== "";
    case "equals":
      return text === (rule.value ?? "");
    case "contains":
    default:
      return (
        trimmed !== "" &&
        text.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase())
      );
  }
}

/**
 * The background colour for one cell, by precedence: an exact cell rule, then a
 * whole-row rule, then a whole-column rule.
 */
export function resolveCellColor(
  fieldId: string,
  rowId: string | undefined,
  lookup: TableColorLookup,
): string | undefined {
  if (rowId) {
    const cell = lookup.cellColors.get(cellColorKey(rowId, fieldId));
    if (cell) return cell;
    const row = lookup.rowColors.get(rowId);
    if (row) return row;
  }
  return lookup.columnColors.get(fieldId);
}

// ============================================================================
// Field CRUD helpers (字段配置 / 字段编辑)
// ============================================================================

/**
 * The field-CRUD helpers now live in `source/row-utils.ts`, because the record
 * editor creates / deletes fields too and must reconcile cells the same way.
 * They stay re-exported here so every existing table import keeps working.
 */
export {
  createDatabaseFieldId,
  reconcileRowsForFields,
} from "../../../source/row-utils";
