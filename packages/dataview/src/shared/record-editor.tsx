// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The unified record editor — the right-hand sheet every view opens.
 *
 * **The host node-content renders it, not `DataViewRoot`.** A record's data and
 * its write path live in the node content (`database-node-content.tsx` /
 * `collection-node-content.tsx`), so that is where a record is edited: the shell
 * only reports *which* record to open through its `onOpenRecord` prop
 * (`data-view-root.tsx`). Keeping the sheet out of the shell is also what keeps
 * it out of the lazy view chunks, and what lets the same editor work on a
 * database node (editable) and on a collection projection (read-only).
 *
 * Modelled on the reference screenshot (`docs/propmt/…` / the node editor's
 * 详情 tab): the record's title on top, then one row per field — type icon and
 * name on the left, the field's own control on the right — the fields the
 * calling view does not already surface folded into a collapsible 隐藏字段
 * block, and 新增字段 at the bottom.
 *
 * It owns no data: the record is looked up in the `source` it is handed, and
 * every edit is reported through the host callbacks it is handed
 * (`onCellChange`, `onFieldsChange`, `onRowDelete`, `onRowInsert`), exactly like
 * a view renderer would (README §3.4).
 *
 * **It is laid out inside the host's box, never against the viewport.** The page
 * is an absolutely positioned column (`inset-y-0 right-0`) plus a click-catching
 * scrim, so the host must render it inside a `relative` box and should mark
 * whatever the page covers as `inert` while it is open. A node-content can be
 * mounted full-screen *or* inside the node editor's dialog window; a
 * viewport-fixed sheet would spill out of that window (and over the attributes
 * sidebar), which is exactly what this rule prevents. The 字段编辑 dialog is a
 * real modal and stays portaled/centred — a modal is allowed to be viewport-level.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Ellipsis, Plus, Trash2, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { ScrollArea } from "@workspace/ui/components/ui/scroll-area";
import { Badge } from "@workspace/ui/components/ui/badge";
import type {
  DatabaseCell,
  DatabaseField,
  DataRow,
  DataViewSource,
} from "@workspace/interfaces";

import { displayText } from "../source/cell-resolver";
import { primaryFieldId } from "../source/field-utils";
import {
  createDataRowId,
  createDatabaseFieldOptionId,
  reconcileRowsForFields,
} from "../source/row-utils";
import { FieldEditor, type FieldEditResult } from "./field-editor";
import { FieldInput } from "./field-input";
import { FieldTypeIcon } from "./field-meta";
import { duplicateRow } from "./record-menu";

export const RECORD_UNTITLED = "未命名记录";

export interface RecordEditorProps {
  open: boolean;
  /** The record being edited; `null` while nothing is selected. */
  rowId: string | null;
  /**
   * The *unfiltered* source the row comes from. The editor must be able to open
   * any record the view it was opened from can show, so a filtered source is
   * the wrong one to pass.
   */
  source: DataViewSource;
  /** Whether the data may be edited at all (collection projections: false). */
  editable: boolean;
  /** Fields the calling view does *not* surface → folded under 隐藏字段. */
  hiddenFieldIds?: readonly string[];
  /** Host callbacks, forwarded to the editor's controls. */
  onCellChange?: (rowId: string, fieldId: string, cell: DatabaseCell) => void;
  onRowInsert?: (row: DataRow, index?: number) => void;
  onRowDelete?: (rowIds: readonly string[]) => void;
  onFieldsChange?: (fields: DatabaseField[], rows?: DataRow[]) => void;
  onOpenNode?: (nodeId: string) => void;
  resolveNodeTitle?: (nodeId: string) => string | undefined;
  onOpenChange: (open: boolean) => void;
}

export function RecordEditor({
  open,
  rowId,
  source,
  editable,
  hiddenFieldIds,
  onCellChange,
  onRowInsert,
  onRowDelete,
  onFieldsChange,
  onOpenNode,
  resolveNodeTitle,
  onOpenChange,
}: RecordEditorProps) {
  const { t } = useI18n();

  const [showHidden, setShowHidden] = useState(false);
  const [fieldDraft, setFieldDraft] = useState<
    { mode: "create" } | { mode: "edit"; field: DatabaseField } | null
  >(null);
  /** The page itself, focused on open so screen readers land on it. */
  const pageRef = useRef<HTMLElement | null>(null);
  /**
   * Whether the scrim has seen a `pointerdown` of its own.
   *
   * A tap opens this page from a *canvas* (a gantt bar, a calendar event) and the
   * browser then dispatches the compatibility mouse sequence for that same tap —
   * `mousedown`, `mouseup` and a `click`, all hit-tested **at dispatch time**. By
   * then the page is mounted, so the phantom `click` landed on the scrim and
   * closed the page the moment it opened (touch only: the mouse path has no
   * compatibility sequence). A click is therefore a dismissal only if this
   * element also saw the pointer go down — a real press or tap on the scrim fires
   * `pointerdown` first, while the tap that *opened* the page fired its own
   * `pointerdown` on the canvas before the scrim existed.
   */
  const scrimArmed = useRef(false);

  // A new record starts folded: the "already visible" fields are the point of
  // the panel, the long tail is what the block is for.
  useEffect(() => {
    setShowHidden(false);
    setFieldDraft(null);
    scrimArmed.current = false;
  }, [rowId]);

  // The page is not a modal (no focus trap), so it takes focus itself.
  useEffect(() => {
    if (open) pageRef.current?.focus();
  }, [open, rowId]);

  /**
   * Escape closes the page — and **only** the page.
   *
   * The host node-content usually sits inside the node editor's `Dialog`, whose
   * Radix dismissal listens for Escape with a **capture** listener on `document`.
   * Two consequences: a bubble-phase handler here is useless (Radix has already
   * dismissed the dialog by the time it runs), and so is `stopPropagation` from a
   * `document` listener (sibling listeners on the same node still run). So this
   * listens on `window` in the capture phase — the event path starts at `window`,
   * so it runs *before* Radix's `document` capture listener and can stop it.
   *
   * It only claims the key while the page owns the focus: a nested portaled layer
   * (the 日期 popover, a dropdown, the 字段编辑 dialog) lives outside the page's
   * DOM and keeps its own Escape.
   */
  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const page = pageRef.current;
      if (!page) return;
      const layer = (event.target as Element | null)?.closest?.(
        [
          "[data-radix-popper-content-wrapper]",
          '[data-slot="popover-content"]',
          '[data-slot="dropdown-menu-content"]',
          '[data-slot="select-content"]',
          '[data-slot="dialog-content"]',
        ].join(","),
      );
      // A layer that does not contain the page is a nested one (the node editor's
      // own dialog *does* contain it), so that layer owns this Escape.
      if (layer && !layer.contains(page)) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [open, rowId, onOpenChange]);

  const row = rowId
    ? source.rows.find((candidate) => candidate.id === rowId)
    : undefined;
  const canEdit = editable && Boolean(onCellChange);
  const canManageFields = editable && Boolean(onFieldsChange);

  const hiddenIds = new Set(hiddenFieldIds ?? []);
  const visibleFields = source.fields.filter(
    (field) => !hiddenIds.has(field.id),
  );
  const hiddenFields = source.fields.filter((field) => hiddenIds.has(field.id));
  const visible = visibleFields.length > 0 ? visibleFields : source.fields;

  const titleField = source.fields.find(
    (field) => field.id === primaryFieldId(source.fields),
  );
  const title = row
    ? displayText(
        row.cells[titleField?.id ?? ""],
        titleField,
        resolveNodeTitle,
      ).trim() || t(RECORD_UNTITLED)
    : t(RECORD_UNTITLED);

  const handleFieldSubmit = (result: FieldEditResult) => {
    if (!onFieldsChange) return;
    const existing = source.fields.some(
      (field) => field.id === result.field.id,
    );
    const nextFields = existing
      ? source.fields.map((field) =>
          field.id === result.field.id ? result.field : field,
        )
      : [...source.fields, result.field];
    // Same rule as the table's 新增字段: a schema with no record at all would
    // otherwise read as "the field did not appear".
    const mintRow = !existing && source.rows.length === 0;
    const baseRows = mintRow
      ? [{ id: createDataRowId(), cells: {} }]
      : source.rows;
    const reconciled = reconcileRowsForFields(
      baseRows,
      nextFields,
      result.seed ? { fieldId: result.field.id, cell: result.seed } : undefined,
    );
    onFieldsChange(
      nextFields,
      reconciled.changed || mintRow ? reconciled.rows : undefined,
    );
    setFieldDraft(null);
  };

  const handleFieldDelete = (field: DatabaseField) => {
    if (!onFieldsChange) return;
    const nextFields = source.fields.filter((entry) => entry.id !== field.id);
    const reconciled = reconcileRowsForFields(source.rows, nextFields);
    onFieldsChange(
      nextFields,
      reconciled.changed ? reconciled.rows : undefined,
    );
  };

  const handleDeleteRecord = () => {
    if (!rowId) return;
    onRowDelete?.([rowId]);
    onOpenChange(false);
  };

  const handleDuplicate = () => {
    if (!row || !onRowInsert) return;
    const index = source.rows.findIndex((entry) => entry.id === row.id);
    duplicateRow(row, onRowInsert, index);
  };

  const renderFieldRow = (field: DatabaseField) => (
    <div
      key={field.id}
      className="group/field grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-start gap-2 rounded-md px-1 py-0.5 hover:bg-muted/40"
    >
      <div className="flex h-7 min-w-0 items-center gap-1.5 pl-1 text-xs text-muted-foreground">
        <FieldTypeIcon type={field.type} className="size-3.5 shrink-0" />
        <span className="truncate" title={field.name}>
          {field.name}
        </span>
        {canManageFields && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={translate("字段操作：{value1}", {
                  value1: field.name,
                })}
                className="size-5 shrink-0 text-muted-foreground opacity-0 group-hover/field:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              >
                <Ellipsis className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-36">
              <DropdownMenuItem
                onSelect={() => setFieldDraft({ mode: "edit", field })}
              >
                {t("编辑字段")}{" "}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => handleFieldDelete(field)}
              >
                {t("删除字段")}{" "}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <FieldInput
        key={`${rowId}:${field.id}`}
        field={field}
        cell={row?.cells[field.id]}
        readOnly={!canEdit}
        onOpenNode={onOpenNode}
        resolveNodeTitle={resolveNodeTitle}
        onCreateOption={
          canManageFields
            ? (name) => {
                const id = createDatabaseFieldOptionId();
                onFieldsChange?.(
                  source.fields.map((entry) =>
                    entry.id === field.id
                      ? {
                          ...entry,
                          options: [...(entry.options ?? []), { id, name }],
                        }
                      : entry,
                  ),
                );
                return id;
              }
            : undefined
        }
        onChange={(cell) => {
          if (rowId) onCellChange?.(rowId, field.id, cell);
        }}
      />
    </div>
  );

  return (
    <>
      {/**
       * The scrim and the page both live *inside* the host's box (`absolute`),
       * not against the viewport: node-content can be a dialog window, and a
       * viewport-fixed sheet would spill out of it and over the attributes
       * sidebar. Clicking the scrim closes the page.
       */}
      {open && Boolean(row) && (
        <>
          <div
            aria-hidden
            data-slot="record-scrim"
            className="absolute inset-0 z-30 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget)
                scrimArmed.current = true;
            }}
            onClick={(event) => {
              // See `scrimArmed`: a click with no press of its own is the
              // compatibility event of the tap that opened the page.
              if (event.target !== event.currentTarget) return;
              if (!scrimArmed.current) return;
              scrimArmed.current = false;
              onOpenChange(false);
            }}
          />
          <aside
            ref={pageRef}
            role="region"
            aria-label={t("记录详情与字段编辑")}
            tabIndex={-1}
            data-slot="record-page"
            className={cn(
              "absolute inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col",
              "border-l bg-popover text-sm text-popover-foreground shadow-lg outline-none",
            )}
          >
            <header className="flex flex-col gap-2 border-b px-4 py-3 pr-12">
              <h2 className="truncate text-base font-medium">{title}</h2>
              <div className="flex items-center gap-1.5">
                <Badge variant="muted" className="font-normal">
                  {source.kind === "database" ? t("数据库记录") : t("图谱节点")}
                </Badge>
                <div className="ml-auto flex items-center gap-1">
                  {editable && onRowInsert && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("复制记录")}
                      onClick={handleDuplicate}
                    >
                      <Copy />
                    </Button>
                  )}
                  {editable && onRowDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("删除记录")}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={handleDeleteRecord}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("关闭记录页")}
                className="absolute top-3 right-3"
                onClick={() => onOpenChange(false)}
              >
                <X />
              </Button>
            </header>

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-0.5 px-3 py-3">
                {visible.map(renderFieldRow)}

                {hiddenFields.length > 0 && (
                  <Collapsible open={showHidden} onOpenChange={setShowHidden}>
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-2 h-7 w-full justify-start gap-1.5 px-1 text-xs font-normal text-muted-foreground"
                      >
                        <ChevronDown
                          className={cn(
                            "size-3.5 transition-transform",
                            showHidden && "rotate-180",
                          )}
                        />
                        {t("{count} 个隐藏字段", {
                          count: hiddenFields.length,
                        })}{" "}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="flex flex-col gap-0.5 pt-1">
                      {hiddenFields.map(renderFieldRow)}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            </ScrollArea>

            {canManageFields && (
              <div className="border-t p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full justify-start gap-1.5 px-2 text-xs font-normal text-muted-foreground"
                  onClick={() => setFieldDraft({ mode: "create" })}
                >
                  <Plus className="size-3.5" />
                  {t("新增字段")}{" "}
                </Button>
              </div>
            )}
          </aside>
        </>
      )}

      <Dialog
        open={fieldDraft !== null}
        onOpenChange={(next) => {
          if (!next) setFieldDraft(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {fieldDraft?.mode === "edit" ? t("编辑字段") : t("新增字段")}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("设置字段的名称、类型、选项与默认值")}{" "}
            </DialogDescription>
          </DialogHeader>
          <FieldEditor
            key={
              fieldDraft?.mode === "edit" ? fieldDraft.field.id : "new-field"
            }
            fields={source.fields}
            field={fieldDraft?.mode === "edit" ? fieldDraft.field : undefined}
            onCancel={() => setFieldDraft(null)}
            onSubmit={handleFieldSubmit}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
