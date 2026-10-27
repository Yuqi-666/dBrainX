// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The condition dropdown: an ordered list of `字段 + 方向` levels with 添加条件
 * below — the design's 分组 / 排序 menu (`docs/propmt/dataview-table-1.md`).
 *
 * It lives in `shared/` because two views draw it: the table uses it for both 分组
 * and 排序, and the kanban's 排序 is the same control (same trigger, same rows,
 * same multi-level priority), so one setting looks and behaves the same in both
 * toolbars.
 *
 * A condition starts with no field (`fieldId: ""`), so its picker reads 选择字段
 * until the user picks one; consumers drop empty levels before use.
 *
 * The trigger is neutral chrome showing the live value (`分组 <字段名>`) — never a
 * tint and never a count badge: the same control looks the same in every toolbar,
 * and a count badge says "something is set" without saying what.
 */
import type { LucideIcon } from "lucide-react";
import { GripVertical, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import { ScrollArea } from "@workspace/ui/components/ui/scroll-area";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/ui/toggle-group";
import type {
  DatabaseField,
  DatabaseFieldType,
  TableCondition,
} from "@workspace/interfaces";

import { FieldPickerButton } from "./field-picker";

/**
 * The two labels an order switch shows for a field type.
 *
 * The design's 排序 screenshot uses 选项顺序 / 选项倒序 for a select field; the
 * wording follows the data so "ascending" always reads naturally.
 */
export function orderLabelsForField(
  type: DatabaseFieldType | undefined,
): [string, string] {
  switch (type) {
    case "select":
    case "multiSelect":
      return [translate("选项顺序"), translate("选项倒序")];
    case "number":
      return ["1 → 9", "9 → 1"];
    case "date":
      return [translate("最早优先"), translate("最晚优先")];
    case "checkbox":
      return [translate("未勾选优先"), translate("已勾选优先")];
    default:
      return ["A → Z", "Z → A"];
  }
}

/** The direction switch of one condition row. */
export function ConditionOrderToggle({
  type,
  value,
  disabled,
  onChange,
  className,
}: {
  type: DatabaseFieldType | undefined;
  value: "asc" | "desc";
  disabled?: boolean;
  onChange: (order: "asc" | "desc") => void;
  className?: string;
}) {
  const { t } = useI18n();

  const [ascLabel, descLabel] = orderLabelsForField(type);
  return (
    <ToggleGroup
      type="single"
      value={value}
      disabled={disabled}
      aria-label={t("排序方向")}
      className={cn("rounded-md border border-border p-0.5", className)}
      onValueChange={(next) => {
        if (next) onChange(next as "asc" | "desc");
      }}
    >
      <ToggleGroupItem
        value="asc"
        size="xs"
        className="h-6 min-w-16 rounded-[calc(var(--radius)-4px)] px-2 text-[11px] text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-xs"
      >
        {ascLabel}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="desc"
        size="xs"
        className="h-6 min-w-16 rounded-[calc(var(--radius)-4px)] px-2 text-[11px] text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-xs"
      >
        {descLabel}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * The readout a 分组 / 排序 trigger shows: the first level's field name, and a
 * `+N` tail when further levels follow. Shared so the table and the kanban word
 * their triggers identically.
 */
export function conditionReadout(
  conditions: readonly TableCondition[],
  fields: readonly DatabaseField[],
): string | undefined {
  const names = conditions
    .map((condition) => fields.find((f) => f.id === condition.fieldId)?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return undefined;
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
}

export interface ConditionMenuProps {
  /** Trigger label, e.g. "分组". */
  label: string;
  /** Panel heading, e.g. "设置分组条件". */
  title: string;
  icon: LucideIcon;
  /** The trigger's readout, e.g. the first condition's field name. */
  value?: string;
  conditions: TableCondition[];
  fields: DatabaseField[];
  disabled?: boolean;
  onChange: (next: TableCondition[]) => void;
  /** Rendered after the heading (排序's 自动排序 switch). */
  headerExtra?: ReactNode;
  className?: string;
}

export function ConditionMenu({
  label,
  title,
  icon: Icon,
  value,
  conditions,
  fields,
  disabled,
  onChange,
  headerExtra,
  className,
}: ConditionMenuProps) {
  const { t } = useI18n();

  const fieldById = new Map(fields.map((field) => [field.id, field]));

  const patch = (index: number, next: Partial<TableCondition>) =>
    onChange(
      conditions.map((condition, position) =>
        position === index ? { ...condition, ...next } : condition,
      ),
    );

  const remove = (index: number) =>
    onChange(conditions.filter((_, position) => position !== index));

  /**
   * 添加条件 appends an empty level: the picker reads 选择字段 until the user
   * chooses the field, which is what makes the new row obviously "not set yet".
   */
  const add = () => onChange([...conditions, { fieldId: "", order: "asc" }]);

  /** Dragging a row onto another swaps their priority. */
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...conditions];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground",
            className,
          )}
        >
          <Icon className="size-3.5" />
          {label}
          {value && (
            <span className="max-w-28 truncate text-foreground">{value}</span>
          )}
        </Button>
      </PopoverTrigger>
      {/* `gap-0`: the shadcn panel ships `gap-4`, which doubled every
          explicit margin below and left a hole above 添加条件. */}
      <PopoverContent align="start" className="w-96 gap-0 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium">{title}</span>
          {headerExtra}
          {conditions.length > 0 && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="ml-auto h-6 px-1.5 text-[11px] text-muted-foreground"
              onClick={() => onChange([])}
            >
              {t("清除")}{" "}
            </Button>
          )}
        </div>

        {/* With no conditions the list must not leave a hole between the title
            and 添加条件 — no empty scroll area, no extra margin. */}
        {conditions.length > 0 && (
          <ScrollArea className="max-h-72">
            <div className="flex flex-col gap-1.5 pr-1">
              {conditions.map((condition, index) => (
                <div
                  key={index}
                  draggable={conditions.length > 1}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", String(index));
                  }}
                  onDragOver={(event) => {
                    if (conditions.length > 1) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = Number(
                      event.dataTransfer.getData("text/plain"),
                    );
                    if (Number.isFinite(from)) move(from, index);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <GripVertical
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground/60",
                      conditions.length > 1 ? "cursor-grab" : "opacity-0",
                    )}
                  />
                  <FieldPickerButton
                    fields={fields}
                    value={condition.fieldId || undefined}
                    triggerClassName="w-28 shrink-0"
                    onValueChange={(fieldId) => patch(index, { fieldId })}
                  />
                  <ConditionOrderToggle
                    type={fieldById.get(condition.fieldId)?.type}
                    value={condition.order}
                    disabled={condition.fieldId === ""}
                    className="ml-auto"
                    onChange={(order) => patch(index, { order })}
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("删除条件")}
                    className="shrink-0 text-muted-foreground"
                    onClick={() => remove(index)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* No fields → nothing to group/sort on; say so rather than offering a
            disabled button that swallows the click. */}
        {fields.length === 0 ? (
          <p className="px-1.5 py-1 text-[11px] text-muted-foreground">
            {t("先添加字段，才能设置条件。")}{" "}
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              "h-7 justify-start gap-1.5 px-1.5 text-xs font-normal text-muted-foreground",
              conditions.length > 0 && "mt-2",
            )}
            onClick={add}
          >
            <Plus className="size-3.5" />
            {t("添加条件")}{" "}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
