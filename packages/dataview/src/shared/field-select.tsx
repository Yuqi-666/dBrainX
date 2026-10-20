// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The shared field picker — one shadcn `Select` over a field list.
 *
 * It lives in `shared/` because more than one view picks a field from inside a
 * settings popover (the kanban's 分组/卡片/排序, the calendar's 字段 panel), and
 * in that position a compact `Select` is the right primitive: the option lists
 * are short, and the table's searchable popover+`Command` picker would add a
 * second floating layer inside the first for no gain.
 *
 * The table's `字段配置` list is a different control on purpose — it needs
 * search, groups, drag and per-field menus — so it keeps its own picker.
 */
import type { DatabaseField } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";

import { FieldTypeIcon } from "./field-meta";

/** Radix reserves `""` for "no value", so "nothing selected" needs a sentinel. */
const NO_FIELD = "__dataview_no_field__";

export interface FieldSelectProps {
  fields: readonly DatabaseField[];
  /** The selected field id, or `""` for none. */
  value: string;
  onValueChange: (fieldId: string) => void;
  /** Trigger text when nothing is selected. */
  placeholder: string;
  /** Adds a leading "no field" row (排序 offers 不排序). */
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function FieldSelect({
  fields,
  value,
  onValueChange,
  placeholder,
  noneLabel,
  disabled,
  className,
}: FieldSelectProps) {
  const selected = fields.find((field) => field.id === value);

  return (
    <Select
      value={selected ? selected.id : NO_FIELD}
      disabled={disabled}
      onValueChange={(next) => onValueChange(next === NO_FIELD ? "" : next)}
    >
      <SelectTrigger
        size="sm"
        aria-label={placeholder}
        className={cn("w-full text-xs", className)}
      >
        <SelectValue>
          {selected ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <FieldTypeIcon
                type={selected.type}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">
              {placeholder}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {noneLabel && (
          <SelectItem
            value={NO_FIELD}
            className="text-xs text-muted-foreground"
          >
            {noneLabel}
          </SelectItem>
        )}
        {fields.map((field) => (
          <SelectItem key={field.id} value={field.id} className="text-xs">
            <FieldTypeIcon
              type={field.type}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{field.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
