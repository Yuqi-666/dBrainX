// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * 筛选 — the filter-condition dropdown (`docs/propmt/dataview-table-1.md` §筛选).
 *
 * A list of `字段 + 运算符 + 值` rows plus 添加条件; all conditions are ANDed.
 * This is the "复用 filter 组件" the design asks for: every table menu that needs
 * a condition (筛选 / 填色) renders the same row controls.
 */
import { GripVertical, ListFilter, Plus, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Badge } from "@workspace/ui/components/ui/badge";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import { ScrollArea } from "@workspace/ui/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";
import type { DatabaseField } from "@workspace/interfaces";

import { ConditionValueInput } from "./condition-controls";
import { FieldPickerButton } from "../../../shared/field-picker";
import {
  TABLE_FILTER_OPERATOR_LABELS,
  activeFilterCount,
  createFilterConditionId,
  filterOperatorsForField,
  removeFilterCondition,
  type TableFilterCondition,
  type TableFilterOperator,
  type TableFilterState,
} from "../core/filter";

export interface TableFilterMenuProps {
  fields: DatabaseField[];
  state: TableFilterState;
  disabled?: boolean;
  onChange: (next: TableFilterState) => void;
  className?: string;
}

export function TableFilterMenu({
  fields,
  state,
  disabled,
  onChange,
  className,
}: TableFilterMenuProps) {
  const { t } = useI18n();

  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const count = activeFilterCount(state);

  const patchCondition = (
    id: string,
    patch: Partial<TableFilterCondition>,
  ): void => {
    onChange(
      state.map((condition) =>
        condition.id === id ? { ...condition, ...patch } : condition,
      ),
    );
  };

  /**
   * 添加条件 appends a condition whose field is still unset: the picker reads
   * 选择字段, the row is inert (`applyTableFilters` ignores unset fields) and the
   * badge stays at zero until the user chooses one.
   */
  const addCondition = () => {
    if (fields.length === 0) return;
    onChange([
      ...state,
      {
        id: createFilterConditionId(),
        fieldId: "",
        operator: "contains",
        value: "",
      },
    ]);
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
            count > 0 &&
              "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            className,
          )}
        >
          <ListFilter className="size-3.5" />
          {t("筛选")}{" "}
          {count > 0 && (
            <Badge className="h-4 min-w-4 justify-center rounded-sm px-1 text-[10px] leading-none">
              {count}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      {/* `gap-0`: the shadcn panel ships `gap-4`, which doubled every
          explicit margin below and left a hole above 添加条件. */}
      <PopoverContent align="start" className="w-96 gap-0 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium">{t("设置筛选条件")}</span>
          {state.length > 0 && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="ml-auto h-6 px-1.5 text-[11px] text-muted-foreground"
              onClick={() => onChange([])}
            >
              {t("清除全部")}{" "}
            </Button>
          )}
        </div>

        {/* No conditions → no empty list: 添加条件 sits right under the title. */}
        {state.length > 0 && (
          <ScrollArea className="max-h-72">
            <div className="flex flex-col gap-1.5 pr-1">
              {state.map((condition) => {
                const field = fieldById.get(condition.fieldId);
                const operators = field
                  ? filterOperatorsForField(field)
                  : (Object.keys(
                      TABLE_FILTER_OPERATOR_LABELS,
                    ) as TableFilterOperator[]);
                return (
                  <div key={condition.id} className="flex items-center gap-1.5">
                    <GripVertical className="size-3.5 shrink-0 text-muted-foreground/60" />
                    <FieldPickerButton
                      fields={fields}
                      value={condition.fieldId || undefined}
                      triggerClassName="w-24 shrink-0"
                      onValueChange={(fieldId) => {
                        const nextField = fieldById.get(fieldId);
                        patchCondition(condition.id, {
                          fieldId,
                          operator: nextField
                            ? (filterOperatorsForField(nextField)[0] ??
                              condition.operator)
                            : condition.operator,
                          value: "",
                        });
                      }}
                    />
                    <Select
                      value={condition.operator}
                      onValueChange={(value) =>
                        patchCondition(condition.id, {
                          operator: value as TableFilterOperator,
                        })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t("筛选运算符")}
                        className="h-7 w-20 shrink-0 py-1 pl-2 text-[11px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {operators.map((operator) => (
                          <SelectItem
                            key={operator}
                            value={operator}
                            className="text-[11px]"
                          >
                            {TABLE_FILTER_OPERATOR_LABELS[operator]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <ConditionValueInput
                      field={field}
                      operator={condition.operator}
                      value={condition.value}
                      onChange={(value) =>
                        patchCondition(condition.id, { value })
                      }
                    />
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t("删除筛选条件")}
                      className="shrink-0 text-muted-foreground"
                      onClick={() =>
                        onChange(removeFilterCondition(state, condition.id))
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* No fields → nothing to filter on. Say so instead of showing a
            disabled button that swallows the click. */}
        {fields.length === 0 ? (
          <p className="px-1.5 py-1 text-[11px] text-muted-foreground">
            {t("先添加字段，才能设置筛选条件。")}{" "}
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              "h-7 justify-start gap-1.5 px-1.5 text-xs font-normal text-muted-foreground",
              state.length > 0 && "mt-2",
            )}
            onClick={addCondition}
          >
            <Plus className="size-3.5" />
            {t("添加条件")}{" "}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
