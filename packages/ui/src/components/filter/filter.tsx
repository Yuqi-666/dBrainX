// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import {
  QueryBuilder,
  defaultCombinators,
  type RuleGroupType,
  type Field,
  type CombinatorSelectorProps,
  type FieldSelectorProps,
  type OperatorSelectorProps,
  type ValueEditorProps,
  type ActionWithRulesProps,
} from "@workspace/utils";
import "../../styles/query-builder.css";

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/ui/select";
import { Input } from "@workspace/ui/components/ui/input";
import { Button } from "@workspace/ui/components/ui/button";
import { Plus, Trash2, X } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

interface FlatOption {
  name: string;
  label: string;
}

function renderOptions(options: readonly FlatOption[], localize = false) {
  return options.map((option) => (
    <SelectItem key={option.name} value={option.name}>
      {localize ? translate(option.label) : option.label}
    </SelectItem>
  ));
}

function isOption(
  option: FlatOption | { options: FlatOption[] },
): option is FlatOption {
  return "name" in option;
}

const CombinatorSelector = ({
  options,
  value,
  handleOnChange,
}: CombinatorSelectorProps) => {
  const { t } = useI18n();

  return (
    <Select value={value} onValueChange={handleOnChange}>
      <SelectTrigger className="w-[100px] h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) =>
          isOption(option) ? (
            <SelectItem key={option.name} value={option.name}>
              {t(option.label)}
            </SelectItem>
          ) : (
            renderOptions(option.options, true)
          ),
        )}
      </SelectContent>
    </Select>
  );
};

const FieldSelector = ({
  options,
  value,
  handleOnChange,
}: FieldSelectorProps) => {
  useI18n();

  return (
    <Select value={value} onValueChange={handleOnChange}>
      <SelectTrigger className="w-[180px] h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) =>
          isOption(option) ? (
            <SelectItem key={option.name} value={option.name}>
              {option.label}
            </SelectItem>
          ) : (
            renderOptions(option.options)
          ),
        )}
      </SelectContent>
    </Select>
  );
};

const OperatorSelector = ({
  options,
  value,
  handleOnChange,
}: OperatorSelectorProps) => {
  const { t } = useI18n();

  return (
    <Select value={value} onValueChange={handleOnChange}>
      <SelectTrigger className="w-[120px] h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) =>
          isOption(option) ? (
            <SelectItem key={option.name} value={option.name}>
              {t(option.label)}
            </SelectItem>
          ) : (
            renderOptions(option.options, true)
          ),
        )}
      </SelectContent>
    </Select>
  );
};

const ValueEditor = ({
  value,
  handleOnChange,
  values,
  inputType,
  type,
}: ValueEditorProps) => {
  const { t } = useI18n();

  const isSelect = type === "select" || (values && values.length > 0);

  if (isSelect === true) {
    return (
      <Select value={(value as string) ?? ""} onValueChange={handleOnChange}>
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values?.map((option) => (
            <SelectItem key={option.name} value={option.name}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      type={inputType || "text"}
      value={(value as string) ?? ""}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        handleOnChange(e.target.value)
      }
      className="h-8 text-xs"
      placeholder={t("Enter value...")}
    />
  );
};

const AddRuleAction = ({ handleOnClick }: ActionWithRulesProps) => {
  const { t } = useI18n();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleOnClick}
      className="h-7 px-2 text-xs gap-1"
    >
      <Plus className="size-3" />
      {t("Add Rule")}{" "}
    </Button>
  );
};

const AddGroupAction = ({ handleOnClick }: ActionWithRulesProps) => {
  const { t } = useI18n();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleOnClick}
      className="h-7 px-2 text-xs gap-1"
    >
      <Plus className="size-3" />
      {t("Add Group")}{" "}
    </Button>
  );
};

const RemoveGroupAction = ({ handleOnClick }: ActionWithRulesProps) => {
  const { t } = useI18n();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleOnClick}
      className="h-7 px-2 text-xs text-destructive gap-1"
    >
      <Trash2 className="size-3" />
      {t("Remove Group")}{" "}
    </Button>
  );
};

const RemoveRuleAction = ({ handleOnClick }: ActionWithRulesProps) => {
  useI18n();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleOnClick}
      className="h-7 px-2 text-destructive"
    >
      <X className="size-3" />
    </Button>
  );
};

export const ShadcnFilterComponents = {
  combinatorSelector: CombinatorSelector,
  fieldSelector: FieldSelector,
  operatorSelector: OperatorSelector,
  valueEditor: ValueEditor,
  addRuleAction: AddRuleAction,
  addGroupAction: AddGroupAction,
  removeGroupAction: RemoveGroupAction,
  removeRuleAction: RemoveRuleAction,
};

// Filter Query Builder Wrapper
export interface FilterQueryBuilderProps {
  fields: Field[];
  query: RuleGroupType;
  onQueryChange: (query: RuleGroupType) => void;
  className?: string;
}

export const FilterQueryBuilder = ({
  fields,
  query,
  onQueryChange,
  className,
}: FilterQueryBuilderProps) => {
  useI18n();

  return (
    <div className={cn("w-full", className)}>
      <QueryBuilder
        fields={fields}
        query={query}
        onQueryChange={onQueryChange}
        controlElements={ShadcnFilterComponents}
        combinators={defaultCombinators}
        showCombinatorsBetweenRules
        showNotToggle={false}
        showShiftActions={false}
        showCloneButtons={false}
        resetOnFieldChange={false}
        resetOnOperatorChange={false}
      />
    </div>
  );
};
