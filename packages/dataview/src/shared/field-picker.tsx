// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The searchable field dropdown a condition row picks its field with
 * (the table's 筛选 / 分组 / 排序 / 填色 and the kanban's 排序).
 *
 * The design asks for "点击选择字段则出现带搜索的字段列表下拉菜单": a button
 * showing the current field, opening a `Command` list with a search box. The
 * compact `FieldSelect` next to it is the other picker: this one trades a click
 * for search, which is what a row inside a settings popover needs when the schema
 * is long. It lives in `shared/` because two views draw it now.
 */
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import type { DatabaseField } from "@workspace/interfaces";

import { FieldTypeIcon, filterFieldsByQuery } from "./field-meta";

export interface FieldPickerButtonProps {
  fields: readonly DatabaseField[];
  value?: string;
  onValueChange: (fieldId: string) => void;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  /** Rendered inline (not in a popover) — used inside a menu's own popover. */
  disabled?: boolean;
  className?: string;
  /** Let the trigger shrink inside a dense row. */
  triggerClassName?: string;
}

export function FieldPickerButton({
  fields,
  value,
  onValueChange,
  placeholder = translate("选择字段"),
  disabled,
  className,
  triggerClassName,
}: FieldPickerButtonProps) {
  const { t } = useI18n();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = fields.find((field) => field.id === value);
  const matches = filterFieldsByQuery(fields, query);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={placeholder}
          className={cn(
            "h-7 min-w-0 justify-between gap-1.5 px-2 text-xs font-normal text-muted-foreground",
            triggerClassName,
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {selected && (
              <FieldTypeIcon
                type={selected.type}
                className="size-3.5 shrink-0"
              />
            )}
            <span
              className={cn("truncate", selected && "text-foreground")}
              title={selected?.name}
            >
              {selected?.name ?? placeholder}
            </span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            placeholder={t("搜索字段")}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty className="py-4 text-xs text-muted-foreground">
              {t("没有匹配的字段")}{" "}
            </CommandEmpty>
            {matches.map((field) => (
              <CommandItem
                key={field.id}
                value={field.id}
                className="text-xs"
                onSelect={() => {
                  onValueChange(field.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <FieldTypeIcon
                  type={field.type}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{field.name}</span>
                {field.id === value && <Check className="size-3.5" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
