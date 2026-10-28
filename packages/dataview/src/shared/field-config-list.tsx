// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

/**
 * The **field list** every 字段配置 panel is built from — the table's own
 * 字段配置 body, minus column groups.
 *
 * The table's list (`views/table/menus/field-menu.tsx`) is the reference design:
 * a search box, icon rows that carry a visibility eye and a per-field "…" menu,
 * and a 新增字段 footer that opens the field editor *as the body of the dropdown
 * menu it was launched from*. Groups are column-specific, so they stay there;
 * everything else is shared, because the kanban, the gallery and the calendar
 * all configure the same schema and should not each invent a second editor
 * entry point.
 *
 * What is shared is the **chrome and the write path**, not the meaning of a row:
 *
 * - the caller owns the row model — {@link FieldConfigRow} — so "visible" means
 *   "on the card" for a card config and "in the tooltip" for the calendar;
 * - a row **annotates** the role the field holds (`badge`, and `locked` for the
 *   primary one) but never *sets* it: every role is a labelled config item above
 *   the list (`FieldSelect`), so the same role is always set the same way and no
 *   setter hides behind a "…" menu. The per-row menu is the shared 编辑字段 /
 *   删除字段 tail only;
 * - the caller owns the writes: `onSubmitField` / `onDeleteField` receive
 *   the edited field so it can update its own config *and* the schema in one
 *   gesture (the renderer-never-writes rule, README §3.4).
 *
 * 编辑字段 keeps the panel open and swaps the menu's body for the form, so the
 * editor lands exactly where the menu was — the menu primitive owns the
 * positioning, there is no rect maths anywhere.
 */
import { useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/ui/input-group";
import { ScrollArea } from "@workspace/ui/components/ui/scroll-area";
import type { DatabaseField } from "@workspace/interfaces";

import { FieldEditorMenuContent, type FieldEditResult } from "./field-editor";
import { FieldTypeIcon, filterFieldsByQuery } from "./field-meta";

/** One row of the list. */
export interface FieldConfigRow {
  field: DatabaseField;
  /** Eye state; `undefined` draws no eye at all (an always-on row). */
  visible?: boolean;
  /** A lock glyph after the name (a card's title field). */
  locked?: boolean;
  /** Muted annotation on the right (封面 / 开始 / 标题). */
  badge?: string;
}

export interface FieldConfigListProps {
  /** The live schema, used by the field editor. */
  fields: readonly DatabaseField[];
  /** The rows to draw, already ordered the way the caller wants them. */
  rows: readonly FieldConfigRow[];
  searchPlaceholder?: string;
  /** Eye handler; absence draws no eye buttons. */
  onToggleVisible?: (field: DatabaseField, visible: boolean) => void;
  /** Drag handler; absence draws no grips. */
  onReorder?: (fromId: string, toId: string) => void;
  /** Submit a new / edited field. Absence disables 编辑字段 and 新增字段. */
  onSubmitField?: (result: FieldEditResult, isNew: boolean) => void;
  /** Delete a field. Absence disables 删除字段. */
  onDeleteField?: (field: DatabaseField) => void;
  addLabel?: string;
  className?: string;
}

/** The editor body, shared by every 字段编辑 entry point. */
const EDITOR_CONTENT_CLASS =
  "max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto p-3";

/**
 * Radix menu props this file needs but the public `DropdownMenuContent` type
 * does not expose, so they have to travel as a spread.
 */
type MenuFocusProps = {
  onOpenAutoFocus?: (event: Event) => void;
};

/** Keeps the 标题 input focused when the 字段编辑 menu opens. */
const KEEP_FORM_FOCUS: MenuFocusProps = {
  onOpenAutoFocus: (event) => event.preventDefault(),
};

/** Which field row's "…" menu is open, and whether it shows the editor. */
type OpenRowMenu = { fieldId: string; mode: "menu" | "edit" };

export function FieldConfigList({
  fields,
  rows,
  searchPlaceholder = translate("搜索字段"),
  onToggleVisible,
  onReorder,
  onSubmitField,
  onDeleteField,
  addLabel = translate("新增字段"),
  className,
}: FieldConfigListProps) {
  const { t } = useI18n();

  const [query, setQuery] = useState("");
  const [rowMenu, setRowMenu] = useState<OpenRowMenu | null>(null);
  const [isAdding, setAdding] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [dragFieldId, setDragFieldId] = useState<string | null>(null);
  const [dropFieldId, setDropFieldId] = useState<string | null>(null);

  const matched = useLocaleMemo(
    () => new Set(filterFieldsByQuery(fields, query).map((field) => field.id)),
    [fields, query],
  );

  /** Rows the search leaves on screen (a row survives on its own name). */
  const visibleRows = useMemo(
    () => rows.filter((row) => matched.has(row.field.id)),
    [rows, matched],
  );

  const closeEditors = () => {
    setRowMenu(null);
    setAdding(false);
    setPendingDeleteId(null);
  };

  const handleSubmit = (result: FieldEditResult) => {
    const isNew = !fields.some((field) => field.id === result.field.id);
    onSubmitField?.(result, isNew);
    closeEditors();
  };

  const renderRow = (row: FieldConfigRow) => {
    const { field, visible, locked, badge } = row;
    const matchesSearch = matched.has(field.id);
    const menuOpen = rowMenu?.fieldId === field.id;
    const editing = menuOpen && rowMenu.mode === "edit";
    const hasMenu = Boolean(onSubmitField || onDeleteField);
    const removing = pendingDeleteId === field.id;

    return (
      <div key={field.id} className="flex flex-col">
        <div
          draggable={Boolean(onReorder)}
          onDragStart={() => setDragFieldId(field.id)}
          onDragEnd={() => {
            setDragFieldId(null);
            setDropFieldId(null);
          }}
          onDragOver={(event) => {
            if (!dragFieldId) return;
            event.preventDefault();
            setDropFieldId(field.id);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragFieldId && dragFieldId !== field.id) {
              onReorder?.(dragFieldId, field.id);
            }
            setDragFieldId(null);
            setDropFieldId(null);
          }}
          className={cn(
            "group/field flex h-7 items-center gap-1.5 rounded-md px-1.5",
            dragFieldId === field.id && "opacity-50",
            dropFieldId === field.id && "bg-muted",
            (!matchesSearch || visible === false) && "opacity-45",
          )}
        >
          <GripVertical
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60",
              onReorder ? "cursor-grab" : "opacity-0",
            )}
          />
          <FieldTypeIcon
            type={field.type}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate" title={field.name}>
            {field.name}
          </span>
          {locked && (
            <Lock className="size-3 shrink-0 text-muted-foreground/70" />
          )}
          {badge && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {badge}
            </span>
          )}

          {visible !== undefined && onToggleVisible && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={
                visible
                  ? translate("隐藏 {value1}", { value1: field.name })
                  : translate("显示 {value1}", { value1: field.name })
              }
              // Unlike the table's column list (which reveals the eye on
              // hover), this list shows it always: the eye is the only thing
              // saying whether the field is on the card / in the tooltip, and a
              // control that is invisible until hover reads as a missing one.
              className={cn(
                "text-muted-foreground",
                visible
                  ? "opacity-70 group-hover/field:opacity-100"
                  : "opacity-100",
              )}
              onClick={() => onToggleVisible(field, !visible)}
            >
              {visible ? (
                <Eye className="size-3.5" />
              ) : (
                <EyeOff className="size-3.5" />
              )}
            </Button>
          )}

          {hasMenu && (
            <DropdownMenu
              open={menuOpen}
              onOpenChange={(next) => {
                // Opening is when a stale confirm is dismissed; closing must not
                // clear anything, because closing is how 编辑字段 hands the
                // panel over to the form.
                if (next) setPendingDeleteId(null);
                setRowMenu(next ? { fieldId: field.id, mode: "menu" } : null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={translate("{value1} 更多操作", {
                    value1: field.name,
                  })}
                  className="text-muted-foreground opacity-0 group-hover/field:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              {/* The menu opens to the right of the "…" button — the field list
                  is already ~288px wide and covering it would hide the row the
                  menu is about. 编辑字段 keeps the panel open and swaps its body
                  in place, so the form lands exactly where the menu was. */}
              <DropdownMenuContent
                side="right"
                align="start"
                sideOffset={4}
                collisionPadding={8}
                data-dataview-field-menu={field.id}
                className={cn(
                  editing ? cn("w-80", EDITOR_CONTENT_CLASS) : "w-44",
                )}
                {...(editing ? KEEP_FORM_FOCUS : {})}
              >
                {editing ? (
                  <FieldEditorMenuContent
                    field={field}
                    fields={fields}
                    onCancel={closeEditors}
                    onSubmit={handleSubmit}
                  />
                ) : (
                  <>
                    {onSubmitField && (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          // Keep the panel open: 编辑字段 replaces the items with
                          // the form instead of dismissing the menu and opening a
                          // second floating panel somewhere else.
                          event.preventDefault();
                          setPendingDeleteId(null);
                          setRowMenu({ fieldId: field.id, mode: "edit" });
                        }}
                      >
                        <Pencil className="size-4" />
                        {t("编辑字段")}{" "}
                      </DropdownMenuItem>
                    )}
                    {onDeleteField && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setPendingDeleteId(field.id)}
                        >
                          <Trash2 className="size-4" />
                          {t("删除字段")}{" "}
                        </DropdownMenuItem>
                      </>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {removing && (
          <div className="mx-1.5 mb-1 flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1.5">
            <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              {t("删除「")}
              {field.name}
              {t("」？该字段的数据一并清除。")}{" "}
            </span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-6 shrink-0 text-[11px]"
              onClick={() => setPendingDeleteId(null)}
            >
              {t("取消")}{" "}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              className="h-6 shrink-0 text-[11px]"
              onClick={() => {
                onDeleteField?.(field);
                setPendingDeleteId(null);
              }}
            >
              {t("删除")}{" "}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <InputGroup className="h-7 rounded-md">
        <InputGroupAddon align="inline-start" className="py-0 pr-0 pl-2">
          <Search className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-7 text-xs"
          onChange={(event) => setQuery(event.target.value)}
        />
      </InputGroup>

      {/* A **definite** height once the list is long enough to overflow.
          Radix's viewport is `h-full`, which resolves to `auto` against an
          auto-height root, so a `max-h-72` root leaves the viewport as tall as
          its *content*: the rows spill ~28px past the clamped box and paint over
          the 新增字段 footer below them, which makes that button unclickable
          (measured: `elementFromPoint` at the button's centre returns the last
          field row's span). `h-72` gives the root a height the viewport can
          resolve against, so the list scrolls inside its own box instead. */}
      <ScrollArea className={visibleRows.length > 7 ? "h-72" : undefined}>
        <div className="flex flex-col gap-1 pr-1">
          {rows.length > 0 && visibleRows.length === 0 && (
            <p className="px-1.5 py-3 text-center text-[11px] text-muted-foreground">
              {t("没有匹配的字段。")}{" "}
            </p>
          )}
          {rows.length === 0 && (
            <p className="px-1.5 py-3 text-center text-[11px] text-muted-foreground">
              {t("这张表还没有字段。")}{" "}
            </p>
          )}
          {visibleRows.map(renderRow)}
        </div>
      </ScrollArea>

      {/* 新增字段 — its own dropdown, hung off its own button. */}
      {onSubmitField && (
        <DropdownMenu
          open={isAdding}
          onOpenChange={(next) => {
            setAdding(next);
            if (next) setPendingDeleteId(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 justify-start gap-1.5 px-1.5 text-xs font-normal text-muted-foreground"
            >
              <Plus className="size-3.5" />
              {addLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            data-dataview-field-add
            className={cn("w-80", EDITOR_CONTENT_CLASS)}
            {...KEEP_FORM_FOCUS}
          >
            <FieldEditorMenuContent
              fields={fields}
              onCancel={closeEditors}
              onSubmit={handleSubmit}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
