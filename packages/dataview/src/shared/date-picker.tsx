// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The unified date editor: a shadcn `Calendar` inside a `Popover`.
 *
 * Every DOM surface that edits a `date` cell uses this component, so a date is
 * always picked the same way (dataview/AGENTS.md § UI conventions). The value
 * is a calendar day or a local datetime with minute precision.
 */
import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import { Calendar } from "@workspace/ui/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";

import { formatFieldDate, parseFieldDate, toFieldDate } from "./field-value";

import { DateTimeInput } from "./date-time-input";

export interface DatePickerProps {
  /** Calendar day or ISO datetime; `null` means no date. */
  value: string | null;
  includeTime?: boolean;
  onChange: (next: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Shows a 清除 affordance while a date is set. */
  clearable?: boolean;
  className?: string;
}

export function DatePicker({
  value,
  includeTime = false,
  onChange,
  placeholder = translate("选择日期"),
  disabled,
  clearable = true,
  className,
}: DatePickerProps) {
  const { t } = useI18n();

  const [open, setOpen] = useState(false);
  const selected = parseFieldDate(value);

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className={cn(
              "h-7 min-w-0 flex-1 justify-start gap-1.5 px-2 text-xs font-normal",
              !selected && "text-muted-foreground",
            )}
          >
            <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {selected ? formatFieldDate(value, includeTime) : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected ?? undefined}
            defaultMonth={selected ?? undefined}
            autoFocus
            onSelect={(date) => {
              if (date) {
                date.setHours(
                  selected?.getHours() ?? 0,
                  selected?.getMinutes() ?? 0,
                  0,
                  0,
                );
                onChange(toFieldDate(date, includeTime));
                if (!includeTime) setOpen(false);
              }
            }}
          />
          {includeTime && (
            <DateTimeInput
              date={selected}
              onChange={(date) => onChange(toFieldDate(date, true))}
            />
          )}
        </PopoverContent>
      </Popover>
      {clearable && selected && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("清除日期")}
          className="size-7 shrink-0 text-muted-foreground"
          onClick={() => onChange(null)}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
