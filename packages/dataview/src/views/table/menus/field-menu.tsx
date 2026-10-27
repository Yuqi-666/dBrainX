// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

/**
 * 字段配置 — the field list dropdown (`docs/propmt/dataview-table-1.md` §字段配置).
 *
 * Contents, top to bottom: a search box, the field list (grouped, drag-reorderable,
 * with per-field visibility and a "…" menu) and 新增字段. Clicking a field's
 * "…" opens the 选项菜单 (编辑 / 创建编组 / 加入编组 / 移出编组 / 删除) to the
 * **right of the button**, and 编辑字段 swaps that same panel's body to the field
 * editor: both are dropdown menus, so the form appears where the menu was instead
 * of being positioned from a measured rect.
 *
 * Three structural choices worth keeping:
 *
 * - **编辑 happens inside the row's own menu.** The panel switches from the item
 *   list to {@link FieldEditorMenuContent} without closing, so 编辑字段 lands
 *   exactly where 选项菜单 was, and the primitive — not this file — decides where
 *   that is.
 * - **新增字段 is its own menu** off the 新增字段 button, and off an invisible
 *   trigger placed at the canvas "+" glyph's rect when the shell asks for it (a
 *   canvas has no DOM node to anchor to).
 * - **A group is a bordered block with its members indented inside it**, and the
 *   chevron collapses it. 创建编组 puts the new group straight into rename mode,
 *   so a group never sits there called "编组 1" until the user finds 重命名.
 *
 * Everything here is config or schema — data writes are reported through the
 * callbacks the shell supplies, never applied locally.
 */
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  Eye,
  EyeOff,
  FolderPlus,
  FolderTree,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Input } from "@workspace/ui/components/ui/input";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import { ScrollArea } from "@workspace/ui/components/ui/scroll-area";
import type {
  DatabaseField,
  DataRow,
  TableColumnGroup,
  TableViewConfig,
} from "@workspace/interfaces";

import {
  applyFieldEdit,
  buildFieldMenuEntries,
  createGroupWithField,
  dissolveGroup,
  groupIdOfField,
  isFieldVisible,
  moveField,
  removeField,
  renameGroup,
  setFieldGroup,
  setFieldVisible,
  setGroupVisible,
  type FieldMenuEntry,
  type GroupMenuRow,
} from "../core/column-ops";
import {
  FieldEditorMenuContent,
  type FieldEditResult,
} from "../../../shared/field-editor";
import {
  FieldTypeIcon,
  filterFieldsByQuery,
  matchesText,
} from "../../../shared/field-meta";

/**
 * Viewport rect of the control the shell asked 新增字段 from.
 *
 * Only the column-end "+" needs this: it is painted on a canvas, so there is
 * no DOM node to hang a menu trigger off and the shell hands over the glyph's
 * rect for an invisible trigger instead. Every other entry point — the 字段配置
 * list's 新增字段 button, each field row's "…" — uses a real button as its
 * trigger.
 */
export interface AddFieldAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Which edge of the anchor the panel lines up with. Defaults to `start`. */
  align?: "start" | "end";
}

/** A request from the shell (the canvas "+", the empty-state button). */
export interface AddFieldRequest {
  /** Bumped per request so pressing the same button twice re-opens the panel. */
  id: number;
  anchor: AddFieldAnchor;
}

/** An inline confirmation / rename pending inside the list. */
type Pending =
  | { kind: "delete"; field: DatabaseField }
  | { kind: "renameGroup"; group: TableColumnGroup }
  | null;

/** Which field row's "…" menu is open, and whether it shows the editor. */
type OpenRowMenu = { fieldId: string; mode: "menu" | "edit" };

export interface TableFieldMenuProps {
  config: TableViewConfig;
  fields: DatabaseField[];
  rows: DataRow[];
  readOnly?: boolean;
  /** Schema writes (database hosts). Its absence disables field CRUD. */
  onFieldsChange?: (fields: DatabaseField[], rows?: DataRow[]) => void;
  onConfigChange?: (config: TableViewConfig) => void;
  /** Set by the shell to open the 新增字段 panel anchored at its own control. */
  addFieldRequest?: AddFieldRequest | null;
  /** The shell clears its request when this panel closes. */
  onAddFieldDismiss?: () => void;
  className?: string;
}

/** The editor body, shared by all three 字段编辑 entry points. */
const EDITOR_CONTENT_CLASS =
  "max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto p-3";

/**
 * Radix menu props this file needs but the public `DropdownMenuContent` type
 * does not expose (`MenuRootContentTypeProps` omits the private props), so they
 * have to travel as a spread.
 */
type MenuFocusProps = {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * Keeps the 标题 input focused when the 字段编辑 menu opens.
 *
 * Radix's menu focuses its own content on open, which would pull the caret out of
 * the form the moment it appears. The behaviour is controlled by
 * `onOpenAutoFocus`, a prop Radix *honours* but strips from the public
 * `DropdownMenuContent` type (`MenuRootContentTypeProps` omits the private
 * props), so it is handed over as a spread.
 */
const KEEP_FORM_FOCUS: MenuFocusProps = {
  onOpenAutoFocus: (event) => event.preventDefault(),
};

export function TableFieldMenu({
  config,
  fields,
  rows,
  readOnly,
  onFieldsChange,
  onConfigChange,
  addFieldRequest,
  onAddFieldDismiss,
  className,
}: TableFieldMenuProps) {
  const { t } = useI18n();

  const [isOpen, setOpen] = useState(false);

  /**
   * The shell's last 新增字段 anchor, kept after the request clears.
   *
   * Radix holds the dropdown content mounted through its exit animation
   * (`data-closed:animate-out`), so a trigger that unmounted together with the
   * request left floating-ui measuring a detached node — the panel visibly
   * jumped to the page's top-left corner (`0,4`) for the fade instead of closing
   * where it stood. Keeping the last rect keeps the exit in place.
   */
  const addFieldAnchorRef = useRef<AddFieldAnchor | null>(null);
  useEffect(() => {
    if (addFieldRequest) addFieldAnchorRef.current = addFieldRequest.anchor;
  }, [addFieldRequest]);
  const addFieldAnchor = addFieldRequest?.anchor ?? addFieldAnchorRef.current;

  const [query, setQuery] = useState("");
  /** The field row whose "…" menu is open (and whether it shows 编辑). */
  const [rowMenu, setRowMenu] = useState<OpenRowMenu | null>(null);
  /** The 字段配置 list's own 新增字段 menu. */
  const [isAdding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [dragFieldId, setDragFieldId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<
    | { kind: "field"; fieldId: string }
    | { kind: "group"; groupId: string }
    | null
  >(null);
  /**
   * Set when a menu item hands the panel over to an inline form (创建编组 →
   * 命名编组, 重命名编组).
   *
   * {@link TableFieldMenu}'s `onCloseAutoFocus` reads this flag and takes over
   * the focus handoff, because Radix's own close-time restore and its focus trap
   * both fight the form for the caret — see that handler.
   */
  const inlineFormFocus = useRef(false);
  /** The mounted 编组名称 input, so the handoff has somewhere to land. */
  const renameInputRef = useRef<HTMLInputElement>(null);

  /**
   * Focus handoff for every menu that can open an inline form.
   *
   * Two Radix behaviours have to be beaten, and this handler is the one moment
   * where both are out of the way:
   *
   * - Radix restores focus to the menu's trigger when the content unmounts
   *   (`setTimeout(…, 0)`), which after 创建编组 is not even the same DOM node —
   *   the field row has been re-parented into the new group.
   * - While the content animates out it is still mounted with a focus **trap**,
   *   which drags the caret back inside the menu the instant the form's own
   *   `autoFocus` fires (measured: focus sat on the "…" item for ~300ms and then
   *   fell to `<body>`). So the form cannot focus itself; it has to be focused
   *   here, from the unmount cleanup — the first tick at which the trap is gone.
   */
  const handleMenuCloseAutoFocus = (event: Event) => {
    if (!inlineFormFocus.current) return;
    inlineFormFocus.current = false;
    event.preventDefault();
    renameInputRef.current?.focus();
  };

  /**
   * The 编组头 "…" buttons, so the naming form can hand focus back when it
   * closes (Radix cannot do it for us: its own focus restore was vetoed above).
   */
  const groupMenuTrigger = useRef(new Map<string, HTMLButtonElement>());

  // Adding a field also adds its column config, so both writes must be allowed.
  const canEditFields =
    Boolean(onFieldsChange) && Boolean(onConfigChange) && !readOnly;
  const canEditColumns = Boolean(onConfigChange);

  const groups = useMemo(() => {
    const seen = new Map<string, TableColumnGroup>();
    for (const entry of buildFieldMenuEntries(config, fields)) {
      if (entry.kind === "group") seen.set(entry.group.id, entry.group);
    }
    return Array.from(seen.values());
  }, [config, fields]);

  const entries = useMemo(
    () => buildFieldMenuEntries(config, fields),
    [config, fields],
  );
  const matched = useLocaleMemo(
    () => new Set(filterFieldsByQuery(fields, query).map((field) => field.id)),
    [fields, query],
  );
  /** How many rows the search leaves on screen (for the empty hint). */
  const visibleEntries = useMemo(() => {
    return entries.reduce((count, entry) => {
      if (entry.kind === "field")
        return count + (matched.has(entry.field.id) ? 1 : 0);
      if (matchesText(entry.group.name, query)) {
        return count + 1 + entry.fields.length;
      }
      return count + 1 + entry.fields.filter((f) => matched.has(f.id)).length;
    }, 0);
  }, [entries, matched, query]);

  /** Every editor surface closes together — they are one task, not three. */
  const closeEditors = () => {
    setRowMenu(null);
    setAdding(false);
    setPending(null);
    onAddFieldDismiss?.();
  };

  const handleEditorSubmit = (next: FieldEditResult) => {
    if (!onConfigChange) return;
    const result = applyFieldEdit(
      config,
      fields,
      rows,
      next.field,
      next.seed ? { fieldId: next.field.id, cell: next.seed } : undefined,
    );
    onConfigChange(result.config);
    onFieldsChange?.(result.fields, result.rows);
    closeEditors();
  };

  const handleDelete = (field: DatabaseField) => {
    if (!onConfigChange) return;
    const result = removeField(config, fields, rows, field.id);
    onConfigChange(result.config);
    onFieldsChange?.(result.fields, result.rows);
    setPending(null);
  };

  const toggleCollapsed = (groupId: string) =>
    setCollapsed((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );

  /** 创建编组: create it, then go straight into naming it. */
  const handleCreateGroup = (field: DatabaseField) => {
    if (!onConfigChange) return;
    const { config: next, group } = createGroupWithField(
      config,
      fields,
      field.id,
    );
    onConfigChange(next);
    setCollapsed((current) => current.filter((id) => id !== group.id));
    inlineFormFocus.current = true;
    setPending({ kind: "renameGroup", group });
  };

  /** 拖动: reorder, and adopt the drop target's group. */
  const handleDrop = (target: FieldMenuEntry) => {
    if (!onConfigChange || !dragFieldId) return;
    const dragged = dragFieldId;
    setDragFieldId(null);
    setDropTarget(null);

    const groupId =
      target.kind === "group"
        ? target.group.id
        : (groupIdOfField(config, fields, target.field.id) ?? null);

    let next = setFieldGroup(config, fields, dragged, groupId);
    if (target.kind === "field" && target.field.id !== dragged) {
      const columns = (next.columns ?? []).map((column) => column.fieldId);
      const from = columns.indexOf(dragged);
      let to = columns.indexOf(target.field.id);
      if (from >= 0 && to >= 0) {
        // Dropping downward lands *after* the hovered row, so the anchor's own
        // slot shifts up by one.
        if (from < to) to -= 1;
        next = moveField(next, fields, dragged, to);
      }
    }
    if (target.kind === "group") {
      setCollapsed((current) => current.filter((id) => id !== target.group.id));
    }
    onConfigChange(next);
  };

  const renderFieldRow = (
    field: DatabaseField,
    visible: boolean,
    group?: TableColumnGroup,
  ) => {
    const matchesSearch = matched.has(field.id);
    const deleting =
      pending?.kind === "delete" && pending.field.id === field.id;
    const menuOpen = rowMenu?.fieldId === field.id;
    const editing = menuOpen && rowMenu.mode === "edit";
    return (
      <div key={field.id} className="flex flex-col">
        <div
          draggable={canEditColumns}
          onDragStart={() => setDragFieldId(field.id)}
          onDragEnd={() => {
            setDragFieldId(null);
            setDropTarget(null);
          }}
          onDragOver={(event) => {
            if (!dragFieldId) return;
            event.preventDefault();
            setDropTarget({ kind: "field", fieldId: field.id });
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleDrop({ kind: "field", field, visible, group });
          }}
          className={cn(
            "group/field flex h-7 items-center gap-1.5 rounded-md px-1.5",
            dragFieldId === field.id && "opacity-50",
            dropTarget?.kind === "field" &&
              dropTarget.fieldId === field.id &&
              "bg-muted",
            !matchesSearch && "opacity-45",
          )}
        >
          <GripVertical
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60",
              canEditColumns ? "cursor-grab" : "opacity-0",
            )}
          />
          <FieldTypeIcon
            type={field.type}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate" title={field.name}>
            {field.name}
          </span>

          {canEditColumns && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={
                visible
                  ? translate("隐藏 {value1}", { value1: field.name })
                  : translate("显示 {value1}", { value1: field.name })
              }
              className={cn(
                "text-muted-foreground",
                visible
                  ? "opacity-0 group-hover/field:opacity-100"
                  : "opacity-100",
              )}
              onClick={() =>
                onConfigChange?.(
                  setFieldVisible(config, fields, field.id, !visible),
                )
              }
            >
              {visible ? (
                <Eye className="size-3.5" />
              ) : (
                <EyeOff className="size-3.5" />
              )}
            </Button>
          )}

          <DropdownMenu
            open={menuOpen}
            onOpenChange={(next) => {
              // Closing is how an item hands the panel over to an inline form
              // (创建编组 → 命名, 删除字段 → 确认), and Radix runs this *after*
              // the item's own `onSelect` — clearing 待办 on close wiped the form
              // in the same tick it was requested. Only opening resets it, which
              // is also what dismisses a stale confirm when the user moves on.
              if (next) {
                setPending(null);
                inlineFormFocus.current = false;
              }
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
                className={cn(
                  "text-muted-foreground",
                  canEditColumns
                    ? "opacity-0 group-hover/field:opacity-100 data-[state=open]:opacity-100"
                    : "opacity-0",
                )}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            {/* The menu opens to the right of the "…" button — the field list is
                already 288px wide and covering it would hide the row the menu is
                about. 编辑字段 keeps the panel open and swaps its body in place,
                so the form lands exactly where the menu was. */}
            <DropdownMenuContent
              side="right"
              align="start"
              sideOffset={4}
              collisionPadding={8}
              data-dataview-field-menu={field.id}
              className={cn(
                editing ? cn("w-80", EDITOR_CONTENT_CLASS) : "w-40",
              )}
              {...(editing ? KEEP_FORM_FOCUS : {})}
              {...({
                onCloseAutoFocus: handleMenuCloseAutoFocus,
              } satisfies MenuFocusProps)}
            >
              {editing ? (
                <FieldEditorMenuContent
                  field={field}
                  fields={fields}
                  onCancel={closeEditors}
                  onSubmit={handleEditorSubmit}
                />
              ) : (
                <>
                  <DropdownMenuItem
                    disabled={!canEditFields}
                    onSelect={(event) => {
                      // Keep the panel open: 编辑字段 replaces the items with the
                      // form instead of dismissing the menu and re-opening a
                      // second floating panel somewhere else.
                      event.preventDefault();
                      setPending(null);
                      setRowMenu({ fieldId: field.id, mode: "edit" });
                    }}
                  >
                    <Pencil className="size-4" />
                    {t("编辑字段")}{" "}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canEditFields || Boolean(group)}
                    onSelect={() => handleCreateGroup(field)}
                  >
                    <FolderPlus className="size-4" />
                    {t("创建编组")}{" "}
                  </DropdownMenuItem>
                  {groups.length > 0 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger disabled={!canEditFields}>
                        <FolderTree className="size-4" />
                        {t("加入编组")}{" "}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-40">
                        {groups.map((entry) => (
                          <DropdownMenuItem
                            key={entry.id}
                            disabled={group?.id === entry.id}
                            onSelect={() =>
                              onConfigChange?.(
                                setFieldGroup(
                                  config,
                                  fields,
                                  field.id,
                                  entry.id,
                                ),
                              )
                            }
                          >
                            {entry.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  {group && (
                    <DropdownMenuItem
                      onSelect={() =>
                        onConfigChange?.(
                          setFieldGroup(config, fields, field.id, null),
                        )
                      }
                    >
                      <FolderTree className="size-4" />
                      {t("移出编组")}{" "}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!canEditFields}
                    onSelect={() => setPending({ kind: "delete", field })}
                  >
                    <Trash2 className="size-4" />
                    {t("删除字段")}{" "}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {deleting && (
          <div className="mx-1.5 mb-1 flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1.5">
            <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              {t("删除「")}
              {field.name}
              {t("」？该列数据一并清除。")}{" "}
            </span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-6 shrink-0 text-[11px]"
              onClick={() => setPending(null)}
            >
              {t("取消")}{" "}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              className="h-6 shrink-0 text-[11px]"
              onClick={() => handleDelete(field)}
            >
              {t("删除")}{" "}
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderGroupBlock = (entry: GroupMenuRow) => {
    const { group, fields: groupFields, visible } = entry;
    // A search hit must stay visible even inside a collapsed group.
    const isCollapsed = collapsed.includes(group.id) && query.trim() === "";
    const renaming =
      pending?.kind === "renameGroup" && pending.group.id === group.id;
    /** Leave 命名模式 and give the caret back to this group's "…" button. */
    const closeRename = () => {
      setPending(null);
      groupMenuTrigger.current.get(group.id)?.focus();
    };
    return (
      <div
        key={group.id}
        onDragOver={(event) => {
          if (!dragFieldId) return;
          event.preventDefault();
          setDropTarget({ kind: "group", groupId: group.id });
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (isCollapsed) toggleCollapsed(group.id);
          handleDrop({
            kind: "group",
            group,
            fields: groupFields,
            visible,
          });
        }}
        className={cn(
          "overflow-hidden rounded-md border border-border",
          dropTarget?.kind === "group" &&
            dropTarget.groupId === group.id &&
            "border-primary/60 bg-primary/5",
        )}
      >
        {/* —— 编组头 —— */}
        <div className="group/group flex h-7 items-center gap-1 bg-muted/50 px-1">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={
              isCollapsed
                ? translate("展开 {value1}", { value1: group.name })
                : translate("折叠 {value1}", { value1: group.name })
            }
            aria-expanded={!isCollapsed}
            className="text-muted-foreground"
            onClick={() => toggleCollapsed(group.id)}
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform",
                !isCollapsed && "rotate-90",
              )}
            />
          </Button>
          <FolderTree className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className="min-w-0 flex-1 truncate font-medium"
            title={group.name}
          >
            {group.name}
          </span>

          {canEditColumns && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={
                visible
                  ? translate("隐藏 {value1}", { value1: group.name })
                  : translate("显示 {value1}", { value1: group.name })
              }
              className={cn(
                "text-muted-foreground",
                visible
                  ? "opacity-0 group-hover/group:opacity-100"
                  : "opacity-100",
              )}
              onClick={() =>
                onConfigChange?.(
                  setGroupVisible(config, fields, group.id, !visible),
                )
              }
            >
              {visible ? (
                <Eye className="size-3.5" />
              ) : (
                <EyeOff className="size-3.5" />
              )}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                ref={(node) => {
                  if (node) groupMenuTrigger.current.set(group.id, node);
                  else groupMenuTrigger.current.delete(group.id);
                }}
                aria-label={translate("{value1} 更多操作", {
                  value1: group.name,
                })}
                className="text-muted-foreground opacity-0 group-hover/group:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              sideOffset={4}
              collisionPadding={8}
              className="w-40"
              {...({
                onCloseAutoFocus: handleMenuCloseAutoFocus,
              } satisfies MenuFocusProps)}
            >
              <DropdownMenuItem
                onSelect={() => {
                  inlineFormFocus.current = true;
                  setPending({ kind: "renameGroup", group });
                }}
              >
                <Pencil className="size-4" />
                {t("重命名编组")}{" "}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  onConfigChange?.(dissolveGroup(config, group.id))
                }
              >
                <Trash2 className="size-4" />
                {t("解散编组")}{" "}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* —— 命名（创建编组后直接进入）/ 成员 —— */}
        {renaming ? (
          <div className="border-t border-border p-1.5">
            <RenameGroupForm
              group={group}
              inputRef={renameInputRef}
              onCancel={closeRename}
              onSubmit={(name) => {
                onConfigChange?.(renameGroup(config, group.id, name));
                closeRename();
              }}
            />
          </div>
        ) : (
          !isCollapsed && (
            <div className="flex flex-col gap-0.5 border-t border-border p-1 pl-4">
              {groupFields.map((field) =>
                renderFieldRow(
                  field,
                  isFieldVisible(config, fields, field.id),
                  group,
                ),
              )}
            </div>
          )
        )}
      </div>
    );
  };

  return (
    <>
      <Popover
        open={isOpen}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setRowMenu(null);
            setAdding(false);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              "h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground",
              className,
            )}
          >
            <FolderTree className="size-3.5" />
            {t("字段配置")}{" "}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          data-dataview-field-list
          align="start"
          className="w-72 p-2"
          onEscapeKeyDown={(event) => {
            // Escape unwinds one level while the 编组名称 form is open: the
            // naming is cancelled, the field list stays. Radix handles Escape
            // with a **capture** listener on `document`, so a handler on the
            // input runs too late to stop the dismissal — the veto has to be
            // here. (`DismissableLayer` only asks the topmost layer, so this
            // stays silent while a row menu is open above the list.)
            if (pending?.kind === "renameGroup") event.preventDefault();
          }}
        >
          <div className="flex flex-col gap-2">
            <InputGroup className="h-7 rounded-md">
              <InputGroupAddon align="inline-start" className="py-0 pr-0 pl-2">
                <Search className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                placeholder={t("搜索字段")}
                aria-label={t("搜索字段")}
                className="h-7 text-xs"
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>

            {/* A **definite** height once the list overflows — see the note in
                `shared/field-config-list.tsx`: with `max-h-*` the Radix viewport
                (`h-full` against an auto-height root) grows to its content and
                the last rows paint over the 新增字段 button, which then cannot be
                clicked. */}
            <ScrollArea className={visibleEntries > 7 ? "h-72" : undefined}>
              <div className="flex flex-col gap-1 pr-1">
                {entries.length > 0 && visibleEntries === 0 && (
                  <p className="px-1.5 py-3 text-center text-[11px] text-muted-foreground">
                    {t("没有匹配的字段。")}{" "}
                  </p>
                )}
                {entries.map((entry) => {
                  // The search box narrows the list: a group survives when its
                  // own name matches (then all members show) or when at least
                  // one member matches (then only those show).
                  if (entry.kind === "field") {
                    return matched.has(entry.field.id)
                      ? renderFieldRow(entry.field, entry.visible)
                      : null;
                  }
                  const groupMatches = matchesText(entry.group.name, query);
                  const members = groupMatches
                    ? entry.fields
                    : entry.fields.filter((field) => matched.has(field.id));
                  if (!groupMatches && members.length === 0) return null;
                  return renderGroupBlock({ ...entry, fields: members });
                })}
              </div>
            </ScrollArea>

            {/* 新增字段 — its own dropdown, hung off its own button. Adding a
                field needs schema write access; hiding/reordering existing
                fields only needs the column config (canEditColumns). */}
            <DropdownMenu
              open={isAdding}
              onOpenChange={(next) => {
                setAdding(next);
                // Same rule as the row menu: opening is when a competing inline
                // form is dismissed, never closing.
                if (next) setPending(null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!canEditFields}
                  className="h-7 justify-start gap-1.5 px-1.5 text-xs font-normal text-muted-foreground"
                >
                  <Plus className="size-3.5" />
                  {t("新增字段")}{" "}
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
                  onSubmit={handleEditorSubmit}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </PopoverContent>
      </Popover>

      {/* The shell's 新增字段 request — the canvas "+" and the empty-state
          button have no trigger of their own to hang a menu off, so an invisible
          one is placed at the rect they reported. The menu primitive still owns
          the panel's position. */}
      <DropdownMenu
        open={Boolean(addFieldRequest)}
        onOpenChange={(next) => {
          if (!next) onAddFieldDismiss?.();
        }}
      >
        {addFieldAnchor &&
          typeof document !== "undefined" &&
          createPortal(
            <DropdownMenuTrigger asChild>
              <span
                data-dataview-field-anchor
                aria-hidden
                style={{
                  position: "fixed",
                  left: addFieldAnchor.x,
                  top: addFieldAnchor.y,
                  width: addFieldAnchor.width,
                  height: addFieldAnchor.height,
                }}
              />
            </DropdownMenuTrigger>,
            document.body,
          )}
        <DropdownMenuContent
          data-dataview-field-add-request={addFieldRequest?.id ?? "closed"}
          side="bottom"
          align={addFieldAnchor?.align ?? "start"}
          sideOffset={4}
          collisionPadding={8}
          className={cn("w-80", EDITOR_CONTENT_CLASS)}
          {...KEEP_FORM_FOCUS}
        >
          <FieldEditorMenuContent
            fields={fields}
            onCancel={closeEditors}
            onSubmit={handleEditorSubmit}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Small inline form so 重命名编组 does not need a second dialog primitive.
 *
 * `autoFocus` only covers the case where nothing else is competing for the caret;
 * when the form was opened from a menu, the shell focuses `inputRef` instead (see
 * `handleMenuCloseAutoFocus`).
 */
function RenameGroupForm({
  group,
  inputRef,
  onCancel,
  onSubmit,
}: {
  group: TableColumnGroup;
  inputRef?: Ref<HTMLInputElement>;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const { t } = useI18n();

  const [name, setName] = useState(group.name);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-muted-foreground">{t("编组名称")}</span>
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          ref={inputRef}
          value={name}
          aria-label={t("编组名称")}
          className="h-7 min-w-0 flex-1 px-2 text-xs"
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit(name);
            // Escape cancels the naming; whether the surrounding list survives is
            // decided by the popover's own `onEscapeKeyDown` (see there).
            if (event.key === "Escape") onCancel();
          }}
        />
        <Button
          type="button"
          size="xs"
          className="h-6 text-[11px]"
          disabled={!name.trim()}
          onClick={() => onSubmit(name)}
        >
          {t("确定")}{" "}
        </Button>
      </div>
    </div>
  );
}
