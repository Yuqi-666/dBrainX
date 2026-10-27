// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useState } from "react";
import { usePopoverLayer } from "@workspace/ui/hooks/use-popover-layer";
import { ColorPicker } from "@workspace/ui/components/selector/color-picker";

import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * 填色 — conditional colours (`docs/propmt/dataview-table-1.md` §填色).
 *
 * Each rule is `颜色 + 范围 + 字段 + 运算符 + 值`, where 范围 is 单元格 / 行 / 列.
 * The shell turns the rules into the per-cell background lookup the canvas
 * `style` callbacks consult (`buildColorLookup`).
 */
import { Palette, Plus, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Badge } from "@workspace/ui/components/ui/badge";
import { Button } from "@workspace/ui/components/ui/button";
import { GripVertical } from "lucide-react";
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
import type {
  DatabaseField,
  TableColorRule,
  TableColorTarget,
} from "@workspace/interfaces";

import { ConditionValueInput } from "./condition-controls";
import { FieldPickerButton } from "../../../shared/field-picker";
import { DEFAULT_FILL_COLOR } from "../../../shared/field-meta";
import {
  TABLE_FILTER_OPERATOR_LABELS,
  filterOperatorsForField,
  type TableFilterOperator,
} from "../core/filter";

const TARGET_LABELS: Record<TableColorTarget, string> = {
  get cell() {
    return translate("单元格");
  },
  get row() {
    return translate("行");
  },
  get column() {
    return translate("列");
  },
};

function createRuleId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `col_${globalCrypto.randomUUID()}`;
  }
  return `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface TableColorMenuProps {
  fields: DatabaseField[];
  rules: TableColorRule[];
  disabled?: boolean;
  onChange: (next: TableColorRule[]) => void;
  className?: string;
}

export function TableColorMenu({
  fields,
  rules,
  disabled,
  onChange,
  className,
}: TableColorMenuProps) {
  const { t } = useI18n();

  const fieldById = new Map(fields.map((field) => [field.id, field]));

  const patch = (id: string, next: Partial<TableColorRule>) =>
    onChange(
      rules.map((rule) => (rule.id === id ? { ...rule, ...next } : rule)),
    );

  /**
   * 添加条件 appends a rule whose field is still unset: the picker reads
   * 选择字段 and the rule stays inert (`buildColorLookup` skips unknown fields)
   * until the user chooses one.
   */
  const addRule = () => {
    if (fields.length === 0) return;
    onChange([
      ...rules,
      {
        id: createRuleId(),
        target: "cell",
        fieldId: "",
        operator: "equals",
        value: "",
        color: DEFAULT_FILL_COLOR,
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
            rules.length > 0 &&
              "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            className,
          )}
        >
          <Palette className="size-3.5" />
          {t("填色")}{" "}
          {rules.length > 0 && (
            <Badge className="h-4 min-w-4 justify-center rounded-sm px-1 text-[10px] leading-none">
              {rules.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      {/* `gap-0`: the shadcn panel ships `gap-4`, which doubled every
          explicit margin below and left a hole above 添加条件. */}
      <PopoverContent align="start" className="w-[26rem] gap-0 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium">{t("设置填色条件")}</span>
          {rules.length > 0 && (
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

        {/* No rules → no empty list: 添加条件 sits right under the title. */}
        {rules.length > 0 && (
          <ScrollArea className="max-h-72">
            <div className="flex flex-col gap-1.5 pr-1">
              {rules.map((rule) => {
                const field = fieldById.get(rule.fieldId);
                const operators = field
                  ? filterOperatorsForField(field)
                  : (Object.keys(
                      TABLE_FILTER_OPERATOR_LABELS,
                    ) as TableFilterOperator[]);
                return (
                  <div key={rule.id} className="flex items-center gap-1.5">
                    <GripVertical className="size-3.5 shrink-0 text-muted-foreground/60" />

                    {/* —— 颜色 —— */}
                    <RuleFillColor
                      value={rule.color}
                      onChange={(color) => patch(rule.id, { color })}
                    />

                    {/* —— 范围 —— */}
                    <Select
                      value={rule.target}
                      onValueChange={(value) =>
                        patch(rule.id, { target: value as TableColorTarget })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t("填色范围")}
                        className="h-7 w-[4.5rem] shrink-0 py-1 pl-2 text-[11px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TARGET_LABELS) as TableColorTarget[]).map(
                          (target) => (
                            <SelectItem
                              key={target}
                              value={target}
                              className="text-[11px]"
                            >
                              {TARGET_LABELS[target]}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>

                    <FieldPickerButton
                      fields={fields}
                      value={rule.fieldId || undefined}
                      triggerClassName="w-24 shrink-0"
                      onValueChange={(fieldId) => {
                        const nextField = fieldById.get(fieldId);
                        patch(rule.id, {
                          fieldId,
                          operator: nextField
                            ? (filterOperatorsForField(nextField)[0] ??
                              rule.operator)
                            : rule.operator,
                          value: "",
                        });
                      }}
                    />

                    <Select
                      value={rule.operator}
                      onValueChange={(value) =>
                        patch(rule.id, {
                          operator: value as TableFilterOperator,
                        })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t("填色运算符")}
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
                      operator={rule.operator}
                      value={rule.value}
                      onChange={(value) => patch(rule.id, { value })}
                    />

                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t("删除填色条件")}
                      className="shrink-0 text-muted-foreground"
                      onClick={() =>
                        onChange(rules.filter((entry) => entry.id !== rule.id))
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

        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={fields.length === 0}
          className={cn(
            "h-7 justify-start gap-1.5 px-1.5 text-xs font-normal text-muted-foreground",
            rules.length > 0 && "mt-2",
          )}
          onClick={addRule}
        >
          <Plus className="size-3.5" />
          {t("添加条件")}{" "}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** A compact fill preview leaves room for the condition fields in each rule. */
function RuleFillColor({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const layer = usePopoverLayer();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) layer.prepareLayer();
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={layer.triggerRef}
          type="button"
          aria-label={t("填色颜色")}
          title={value}
          className="size-6 shrink-0 rounded-md border border-foreground/10 shadow-xs outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ background: value }}
        />
      </PopoverTrigger>
      <PopoverContent
        container={layer.container}
        style={{ zIndex: layer.zIndex }}
        align="start"
        className="w-72 rounded-xl p-0"
      >
        <ColorPicker
          value={value}
          aria-label={t("填色颜色")}
          onChange={(color) => {
            onChange(color);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
