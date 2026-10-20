// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The unified record context menu.
 *
 * One item model, rendered by three surfaces so a record behaves the same
 * wherever it is right-clicked:
 *
 * - `<RecordContextMenu>` wraps a DOM node in a shadcn `ContextMenu` (the kanban
 *   card, the gallery card and the calendar event's content);
 * - `<RecordMenuItems>` renders the same items as `DropdownMenuItem`s — the
 *   shape a menu needs when it is opened imperatively rather than by a
 *   right-click (`<RecordMenuAtPoint>`);
 * - `buildRecordSections` feeds the table, whose cells live on a VTable canvas
 *   and can only render `{ text, menuKey }` entries.
 *
 * **The common items are the record's own actions** (打开记录 / 打开节点 /
 * 复制记录 / 删除记录); a view adds its own through `sections` — the kanban's
 * 移动到 swimlane and the gallery's 选择 / 删除选中. The shell supplies the
 * handlers, so a view never re-implements "delete this record".
 */
import { Copy, ExternalLink, PanelRightOpen, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@workspace/ui/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import type { DataRow } from "@workspace/interfaces";

import { createDataRowId } from "../source/row-utils";
import { BodyLayer } from "./body-layer";
import {
  useRecordActions,
  type RecordMenuOptions,
  type RecordMenuItem,
  type RecordMenuSection,
  type RecordActionsContextValue,
} from "./record-actions";

export type { RecordMenuItem, RecordMenuOptions, RecordMenuSection };

/** Menu keys the table's VTable menu reports back for the shared items. */
export const RECORD_MENU_KEYS = {
  open: "dv_record_open",
  openNode: "dv_record_open_node",
  duplicate: "dv_record_duplicate",
  delete: "dv_record_delete",
} as const;

/** The row behind a menu, or `undefined` when it has just been deleted. */
function findRow(
  source: RecordActionsContextValue["source"],
  rowId: string,
): DataRow | undefined {
  return source.rows.find((row) => row.id === rowId);
}

/**
 * Duplicates a record: same cells, fresh id, inserted right after the original.
 *
 * Written as a pure helper so it can be unit-reasoned about and reused by the
 * table's menu mapping (which has no access to the React context).
 */
export function duplicateRow(
  row: DataRow,
  insertRow: (row: DataRow, index?: number) => void,
  index: number,
): void {
  insertRow({ id: createDataRowId(), cells: { ...row.cells } }, index + 1);
}

/** The shared section (record actions available on every view) + `extras`. */
export function buildRecordSections(
  actions: RecordActionsContextValue,
  rowId: string,
  options?: RecordMenuOptions,
): RecordMenuSection[] {
  const { source, editable, onRowInsert, onRowDelete, onOpenNode, openRecord } =
    actions;
  const row = findRow(source, rowId);
  if (!row) return [];

  const index = source.rows.findIndex((candidate) => candidate.id === rowId);
  const isCollection = source.kind === "collection";
  const nodeId = isCollection ? (source.nodeIds?.[index] ?? rowId) : undefined;

  const items: RecordMenuItem[] = [
    {
      id: RECORD_MENU_KEYS.open,
      label: translate("打开记录"),
      icon: PanelRightOpen,
      onSelect: () => openRecord(rowId, options),
    },
  ];

  if (isCollection && onOpenNode && nodeId) {
    items.push({
      id: RECORD_MENU_KEYS.openNode,
      label: translate("打开节点"),
      icon: ExternalLink,
      onSelect: () => onOpenNode(nodeId),
    });
  }

  if (editable && onRowInsert) {
    items.push({
      id: RECORD_MENU_KEYS.duplicate,
      label: translate("复制记录"),
      icon: Copy,
      onSelect: () => duplicateRow(row, onRowInsert, index),
    });
  }

  if (editable && onRowDelete) {
    items.push({
      id: RECORD_MENU_KEYS.delete,
      label: translate("删除记录"),
      icon: Trash2,
      destructive: true,
      onSelect: () => onRowDelete([rowId]),
    });
  }

  const sections: RecordMenuSection[] = [{ id: "record", items }];
  for (const section of options?.sections ?? []) {
    if (section.items.length > 0) sections.push(section);
  }
  return sections;
}

/** Wraps a DOM node in the unified right-click menu. */
export function RecordContextMenu({
  rowId,
  hiddenFieldIds,
  sections,
  disabled,
  children,
}: {
  rowId: string;
  hiddenFieldIds?: readonly string[];
  sections?: readonly RecordMenuSection[];
  /** Renders the children untouched (e.g. a read-only surface with no actions). */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  useI18n();

  const actions = useRecordActions();
  if (disabled) return <>{children}</>;

  const built = buildRecordSections(actions, rowId, {
    hiddenFieldIds,
    sections,
  });
  if (built.every((section) => section.items.length === 0)) {
    return <>{children}</>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        {built.map((section, sectionIndex) => (
          <div key={section.id} className="contents">
            {sectionIndex > 0 && <ContextMenuSeparator />}
            {section.items.map((item) =>
              item.items && item.items.length > 0 ? (
                <ContextMenuSub key={item.id}>
                  <ContextMenuSubTrigger disabled={item.disabled}>
                    {item.icon && <item.icon className="size-4" />}
                    {item.label}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-44">
                    {item.items.map((child) => (
                      <ContextMenuItem
                        key={child.id}
                        disabled={child.disabled}
                        variant={child.destructive ? "destructive" : "default"}
                        onSelect={child.onSelect}
                      >
                        {child.icon && <child.icon className="size-4" />}
                        {child.label}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : (
                <ContextMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  variant={item.destructive ? "destructive" : "default"}
                  onSelect={item.onSelect}
                >
                  {item.icon && <item.icon className="size-4" />}
                  {item.label}
                </ContextMenuItem>
              ),
            )}
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The same items as `DropdownMenuItem`s — the dropdown shape of the menu. */
export function RecordMenuItems({
  rowId,
  hiddenFieldIds,
  sections,
  onDone,
}: {
  rowId: string;
  hiddenFieldIds?: readonly string[];
  sections?: readonly RecordMenuSection[];
  /** Called after any item fires (a dropdown wants to close itself). */
  onDone?: () => void;
}) {
  useI18n();

  const actions = useRecordActions();
  const built = buildRecordSections(actions, rowId, {
    hiddenFieldIds,
    sections,
  });

  return (
    <>
      {built.map((section, sectionIndex) => (
        <div key={section.id} className="contents">
          {sectionIndex > 0 && <DropdownMenuSeparator />}
          {section.items.map((item) =>
            item.items && item.items.length > 0 ? (
              <DropdownMenuSub key={item.id}>
                <DropdownMenuSubTrigger disabled={item.disabled}>
                  {item.icon && <item.icon className="size-4" />}
                  {item.label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  {item.items.map((child) => (
                    <DropdownMenuItem
                      key={child.id}
                      disabled={child.disabled}
                      variant={child.destructive ? "destructive" : "default"}
                      onSelect={() => {
                        child.onSelect?.();
                        onDone?.();
                      }}
                    >
                      {child.icon && <child.icon className="size-4" />}
                      {child.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem
                key={item.id}
                disabled={item.disabled}
                variant={item.destructive ? "destructive" : "default"}
                onSelect={() => {
                  item.onSelect?.();
                  onDone?.();
                }}
              >
                {item.icon && <item.icon className="size-4" />}
                {item.label}
              </DropdownMenuItem>
            ),
          )}
        </div>
      ))}
    </>
  );
}

/**
 * The record menu at an arbitrary viewport point — the imperative twin of
 * `<RecordContextMenu>`.
 *
 * A surface whose records are not React nodes (FullCalendar draws its events
 * itself) cannot have a Radix trigger *inside* the record: a right-click lands
 * on the library's own element, not on the content we rendered into it. Those
 * views therefore listen for `contextmenu` themselves and call
 * `openRecordMenu(point, rowId)`; the shell mounts this component at that point.
 *
 * It is a `DropdownMenu` over a 1×1 fixed anchor rather than a `ContextMenu`,
 * because Radix's context menu can only open from a real `contextmenu` event on
 * its own trigger, and this one is opened programmatically.
 *
 * The whole menu goes through {@link BodyLayer}: a `position: fixed` anchor
 * inside a transformed ancestor — the node editor's centred dialog — is measured
 * from that ancestor rather than the viewport, which puts the menu somewhere
 * other than the pointer (`shared/body-layer.tsx`).
 */
export function RecordMenuAtPoint({
  point,
  rowId,
  hiddenFieldIds,
  sections,
  onClose,
}: {
  point: { x: number; y: number };
  rowId: string;
  hiddenFieldIds?: readonly string[];
  sections?: readonly RecordMenuSection[];
  onClose: () => void;
}) {
  useI18n();

  return (
    <BodyLayer>
      <DropdownMenu
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            style={{
              position: "fixed",
              left: point.x,
              top: point.y,
              width: 1,
              height: 1,
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={2}
          className="w-44"
        >
          <RecordMenuItems
            rowId={rowId}
            hiddenFieldIds={hiddenFieldIds}
            sections={sections}
            onDone={onClose}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </BodyLayer>
  );
}
