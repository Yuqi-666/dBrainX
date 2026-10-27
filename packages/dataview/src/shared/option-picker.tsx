// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The unified 单选 / 多选 editor.
 *
 * Trigger = the same tinted `Badge`s the read-only renderer draws
 * (`shared/field-value.tsx`); panel = a shadcn `Command` with 查找或创建选项,
 * exactly like the table's canvas dropdown does with hand-rolled geometry. The
 * 单选 panel closes on a pick, the 多选 panel stays open because assembling a
 * set is the point of it.
 *
 * Creating an option is the caller's job: `onCreateOption` returns the new id
 * (the record editor writes the field through `onFieldsChange`). When it is
 * absent the 创建 row is not offered — a read-only projection cannot extend a
 * schema.
 */
import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
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

import { resolveOptionColor } from "./field-meta";
import { OptionBadge } from "./field-value";

export interface OptionPickerProps {
  field: DatabaseField;
  /** Selected option ids. */
  value: readonly string[];
  multiple: boolean;
  onChange: (optionIds: string[]) => void;
  /** Adds `name` to the field's options and returns the new id, or `undefined`. */
  onCreateOption?: (name: string) => string | undefined;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function OptionPicker({
  field,
  value,
  multiple,
  onChange,
  onCreateOption,
  disabled,
  placeholder = translate("选择选项"),
  className,
}: OptionPickerProps) {
  const { t } = useI18n();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = field.options ?? [];
  const selected = new Set(value);
  const chosen = options.filter((option) => selected.has(option.id));
  const trimmedQuery = query.trim();
  const canCreate =
    Boolean(onCreateOption) &&
    trimmedQuery.length > 0 &&
    !options.some(
      (option) =>
        option.name.toLocaleLowerCase() === trimmedQuery.toLocaleLowerCase(),
    );

  const commit = (ids: string[]) => {
    onChange(ids);
  };

  const toggle = (optionId: string) => {
    if (selected.has(optionId)) {
      commit(value.filter((id) => id !== optionId));
    } else {
      commit(multiple ? [...value, optionId] : [optionId]);
    }
    if (!multiple) setOpen(false);
  };

  const create = () => {
    if (!onCreateOption || !trimmedQuery) return;
    const id = onCreateOption(trimmedQuery);
    setQuery("");
    if (!id) return;
    commit(multiple ? [...value, id] : [id]);
    if (!multiple) setOpen(false);
  };

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
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-auto min-h-7 w-full min-w-0 justify-start gap-1 px-1.5 py-1 text-xs font-normal",
            chosen.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          {chosen.length === 0 ? (
            <span className="truncate px-0.5">{placeholder}</span>
          ) : (
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              {chosen.map((option, index) => (
                <OptionBadge
                  key={option.id}
                  label={option.name}
                  color={resolveOptionColor(option, index)}
                />
              ))}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command shouldFilter>
          <CommandInput
            autoFocus
            placeholder={t("查找或创建选项")}
            value={query}
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canCreate) {
                event.preventDefault();
                create();
              }
            }}
          />
          <CommandList>
            {!canCreate && <CommandEmpty>{t("没有匹配的选项")}</CommandEmpty>}
            <CommandGroup>
              {options.map((option, index) => (
                <CommandItem
                  key={option.id}
                  value={option.name}
                  keywords={[option.id]}
                  onSelect={() => toggle(option.id)}
                  className="text-xs"
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: resolveOptionColor(option, index),
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {selected.has(option.id) && (
                    <Check className="size-3.5 shrink-0 text-primary" />
                  )}
                </CommandItem>
              ))}
              {canCreate && (
                <CommandItem
                  value={translate("创建 {value1}", { value1: trimmedQuery })}
                  forceMount
                  onSelect={create}
                  className="text-xs"
                >
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {t("创建「")}
                    {trimmedQuery}」
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
