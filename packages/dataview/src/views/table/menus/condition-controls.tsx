// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The small controls the 筛选 / 填色 menus share: a type-aware value input.
 *
 * The `字段 + 方向` condition row (and its order switch) is not here — it serves
 * two views, so it lives in `shared/condition-menu.tsx`.
 */
import { cn } from "@workspace/ui/lib/utils";
import { Input } from "@workspace/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";
import type { DatabaseField } from "@workspace/interfaces";

import { DatePicker } from "../../../shared/date-picker";
import type { TableFilterOperator } from "../core/filter";

/** Radix `Select` rejects an empty item value, so "not set" needs a sentinel. */
const NONE = "__none__";

/** Enum-ish values compare by equality, so the input becomes a picker. */
function optionValuesFor(field: DatabaseField | undefined): string[] | null {
  if (!field) return null;
  if (field.type === "select" || field.type === "multiSelect") {
    return (field.options ?? []).map((option) => option.name);
  }
  if (field.type === "checkbox") return ["是", "否"];
  return null;
}

/**
 * The third control of a condition row: free text, an option picker or a
 * boolean picker, depending on the field the condition points at.
 */
export function ConditionValueInput({
  field,
  operator,
  value,
  disabled,
  placeholder = translate("请输入"),
  onChange,
  className,
}: {
  field: DatabaseField | undefined;
  operator: TableFilterOperator;
  value: string | undefined;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { t } = useI18n();

  const inert = operator === "empty" || operator === "notEmpty";
  const optionValues = optionValuesFor(field);

  if (optionValues) {
    return (
      <Select
        value={value || NONE}
        disabled={disabled || inert}
        onValueChange={(next) => onChange(next === NONE ? "" : next)}
      >
        <SelectTrigger
          size="sm"
          aria-label={t("条件值")}
          className={cn("h-7 min-w-0 flex-1 py-1 pl-2 text-[11px]", className)}
        >
          <SelectValue placeholder={t("请选择")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} className="text-[11px]">
            {t("请选择")}{" "}
          </SelectItem>
          {optionValues.map((option) => (
            <SelectItem key={option} value={option} className="text-[11px]">
              {field?.type === "checkbox" ? t(option) : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field?.type === "date") {
    return (
      <DatePicker
        value={value || null}
        disabled={disabled || inert}
        placeholder={inert ? "—" : placeholder}
        className={cn(
          "h-7 min-w-0 flex-1 rounded-lg border border-input/80 bg-background/80",
          className,
        )}
        onChange={(next) => onChange(next ?? "")}
      />
    );
  }

  return (
    <Input
      aria-label={t("条件值")}
      className={cn("h-7 min-w-0 flex-1 px-2 text-[11px]", className)}
      disabled={disabled || inert}
      value={value ?? ""}
      placeholder={inert ? "—" : placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
