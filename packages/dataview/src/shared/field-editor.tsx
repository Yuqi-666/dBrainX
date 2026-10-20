// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { usePopoverLayer } from "@workspace/ui/hooks/use-popover-layer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import { ColorPicker } from "@workspace/ui/components/selector/color-picker";

import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The field editor — the form behind 添加字段 / 字段项的"编辑" and the record
 * editor's 新增字段 / 编辑字段 (`docs/propmt/dataview-table-1.md` §字段).
 *
 * It edits a *draft* only: nothing is persisted until 确定, which hands the
 * finished field (plus an optional default cell) back to the caller. The caller
 * reconciles the rows and reports the whole thing upward through
 * `onFieldsChange`; this component never touches data.
 *
 * Two hosts render it: the table's 字段配置 menu (through
 * {@link FieldEditorMenuContent}) and the record editor's dialog. The table
 * shows it as the body of a **dropdown menu**, never in a hand-positioned
 * floating panel: the menu primitive does the anchoring, so the editor lands
 * exactly where the menu it replaced was (字段项的"…" → 编辑字段) or off the
 * button that opened it (新增字段), and it follows its trigger on scroll and
 * resize like every other menu in the view.
 *
 * 标题 / 字段类型 / 选项内容 / 默认值 are the four blocks the design asks for.
 * The option list is drag-reorderable and colour-taggable, and a select-ish
 * field without at least one named option cannot be submitted — the domain
 * value object rejects it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import { Label } from "@workspace/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";
import { Switch } from "@workspace/ui/components/ui/switch";
import type {
  DatabaseCell,
  DatabaseField,
  DatabaseFieldOption,
  DatabaseFieldType,
} from "@workspace/interfaces";

import {
  FIELD_TYPE_ICONS,
  FIELD_TYPE_LABELS,
  OPTION_COLORS,
  fieldHasOptions,
  resolveOptionColor,
} from "./field-meta";
import {
  createDatabaseFieldId,
  createDatabaseFieldOptionId,
} from "../source/row-utils";

const FIELD_TYPES: DatabaseFieldType[] = [
  "text",
  "number",
  "select",
  "multiSelect",
  "date",
  "checkbox",
  "url",
  "relation",
];

/** Radix `Select` rejects an empty item value, so "not set" needs a sentinel. */
const NONE = "__none__";

interface DraftOption {
  id: string;
  name: string;
  color: string;
}

interface Draft {
  name: string;
  type: DatabaseFieldType;
  options: DraftOption[];
  /** Free text default (text / number / url / date) or a select option id. */
  defaultText: string;
  defaultOptionIds: string[];
  defaultChecked: boolean;
  includeTime: boolean;
}

function draftFromField(field: DatabaseField | undefined): Draft {
  if (!field) {
    return {
      name: "",
      type: "text",
      options: [],
      defaultText: "",
      defaultOptionIds: [],
      defaultChecked: false,
      includeTime: false,
    };
  }
  return {
    name: field.name,
    type: field.type,
    options: (field.options ?? []).map((option, index) => ({
      id: option.id,
      name: option.name,
      color: resolveOptionColor(option, index),
    })),
    defaultText: "",
    defaultOptionIds: [],
    defaultChecked: false,
    includeTime: field.includeTime ?? false,
  };
}

/** The cell a default-value draft seeds into rows that have no value yet. */
function buildDefaultCell(
  type: DatabaseFieldType,
  draft: Draft,
): DatabaseCell | undefined {
  const text = draft.defaultText.trim();
  switch (type) {
    case "text":
      return text ? { type: "text", text: draft.defaultText } : undefined;
    case "number": {
      if (!text) return undefined;
      const parsed = Number(text);
      return Number.isFinite(parsed)
        ? { type: "number", number: parsed }
        : undefined;
    }
    case "select":
      return draft.defaultText && draft.defaultText !== NONE
        ? { type: "select", optionId: draft.defaultText }
        : undefined;
    case "multiSelect":
      return draft.defaultOptionIds.length > 0
        ? { type: "multiSelect", optionIds: [...draft.defaultOptionIds] }
        : undefined;
    case "date":
      return undefined;
    case "checkbox":
      // `false` is indistinguishable from "no default", so only `true` seeds.
      return draft.defaultChecked
        ? { type: "checkbox", checked: true }
        : undefined;
    case "url": {
      if (!text) return undefined;
      try {
        new URL(text);
        return { type: "url", url: text };
      } catch {
        return undefined;
      }
    }
    case "relation":
      return undefined;
  }
}

/**
 * An option's colour: a round swatch that opens the palette.
 *
 * The swatch is the size and shape the cell capsule uses, so the editor reads as
 * a preview of what the table will draw.
 */
function ColorSwatchButton({
  color,
  label,
  onChange,
}: {
  color: string;
  label: string;
  onChange: (color: string) => void;
}) {
  useI18n();
  const [open, setOpen] = useState(false);
  const layer = usePopoverLayer();
  const ariaLabel = translate("{value1} 选项颜色", { value1: label });
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
          aria-label={ariaLabel}
          title={ariaLabel}
          className="flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className="size-4 rounded-full border border-foreground/10 shadow-xs"
            style={{ background: color }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={layer.container}
        style={{ zIndex: layer.zIndex }}
        align="start"
        className="w-72 rounded-xl p-0"
      >
        <ColorPicker
          value={color}
          aria-label={ariaLabel}
          onChange={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export interface FieldEditResult {
  field: DatabaseField;
  /** Applied to every row whose cell for this field is still empty. */
  seed?: DatabaseCell;
}

export interface FieldEditorProps {
  /** The field being edited; absent when adding. */
  field?: DatabaseField;
  /** Existing schema — used to prefill option defaults and validate names. */
  fields: readonly DatabaseField[];
  /** Absent → 取消/确定 are hidden and the caller closes the dropdown. */
  onCancel?: () => void;
  onSubmit: (next: FieldEditResult) => void;
  className?: string;
}

export function FieldEditor({
  field,
  fields,
  onCancel,
  onSubmit,
  className,
}: FieldEditorProps) {
  const { t } = useI18n();

  const [draft, setDraft] = useState<Draft>(() => draftFromField(field));
  const [draggingOptionId, setDraggingOptionId] = useState<string | null>(null);
  const isNew = !field;

  const patch = (next: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...next }));

  const namedOptions = useMemo(
    () => draft.options.filter((option) => option.name.trim() !== ""),
    [draft.options],
  );

  const nameTaken = useMemo(
    () =>
      fields.some(
        (entry) =>
          entry.id !== field?.id &&
          entry.name.trim().toLocaleLowerCase() ===
            draft.name.trim().toLocaleLowerCase(),
      ),
    [fields, field?.id, draft.name],
  );

  const needsOptions = fieldHasOptions(draft.type);
  const missingOptions = needsOptions && namedOptions.length === 0;
  const nameInvalid = draft.name.trim() === "";
  const canSubmit = !nameInvalid && !missingOptions;

  const setOption = (id: string, next: Partial<DraftOption>) =>
    patch({
      options: draft.options.map((option) =>
        option.id === id ? { ...option, ...next } : option,
      ),
    });

  const addOption = () =>
    patch({
      options: [
        ...draft.options,
        {
          id: createDatabaseFieldOptionId(),
          name: "",
          color: OPTION_COLORS[draft.options.length % OPTION_COLORS.length]!,
        },
      ],
    });

  const removeOption = (id: string) =>
    patch({
      options: draft.options.filter((option) => option.id !== id),
      defaultOptionIds: draft.defaultOptionIds.filter((entry) => entry !== id),
      defaultText: draft.defaultText === id ? "" : draft.defaultText,
    });

  /** Drops the dragged option at the hovered option's position. */
  const moveOption = (targetId: string) => {
    const from = draft.options.findIndex(
      (option) => option.id === draggingOptionId,
    );
    const to = draft.options.findIndex((option) => option.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...draft.options];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    patch({ options: next });
  };

  const submit = () => {
    if (!canSubmit) return;
    const name = draft.name.trim();
    const options: DatabaseFieldOption[] | undefined = needsOptions
      ? namedOptions.map((option) => ({
          id: option.id,
          name: option.name.trim(),
          color: option.color,
        }))
      : undefined;

    onSubmit({
      field: {
        id: field?.id ?? createDatabaseFieldId(),
        name,
        type: draft.type,
        ...(options ? { options } : {}),
        ...(draft.type === "date" ? { includeTime: draft.includeTime } : {}),
      },
      seed: buildDefaultCell(draft.type, draft),
    });
  };

  const typesWithDefault: DatabaseFieldType[] = [
    "text",
    "number",
    "select",
    "multiSelect",
    "date",
    "checkbox",
    "url",
  ];
  const showDefault = typesWithDefault.includes(draft.type);

  return (
    <div
      data-dataview-field-editor={field?.id ?? "new"}
      className={cn("flex w-full flex-col gap-3 text-xs", className)}
    >
      {/* —— 标题 —— */}
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="dv-field-title"
          className="text-[11px] text-muted-foreground"
        >
          {t("标题")}{" "}
        </Label>
        <Input
          id="dv-field-title"
          autoFocus={isNew}
          value={draft.name}
          placeholder={t("字段名称")}
          aria-invalid={nameInvalid}
          className="h-8 text-xs md:text-xs"
          onChange={(event) => patch({ name: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canSubmit) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {nameTaken && !nameInvalid && (
          <p className="text-[11px] text-muted-foreground">
            {t("已有同名字段，仍可继续。")}{" "}
          </p>
        )}
      </div>

      {/* —— 字段类型 —— */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] text-muted-foreground">
          {t("字段类型")}
        </Label>
        <Select
          value={draft.type}
          onValueChange={(value) => patch({ type: value as DatabaseFieldType })}
        >
          <SelectTrigger
            size="sm"
            aria-label={t("字段类型")}
            className="h-8 w-full py-1 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((type) => {
              const Icon = FIELD_TYPE_ICONS[type];
              return (
                <SelectItem key={type} value={type} className="text-xs">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  {FIELD_TYPE_LABELS[type]}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {!isNew && draft.type !== field?.type && (
          <p className="text-[11px] text-muted-foreground">
            {t("改变类型会清空该列现有数据。")}{" "}
          </p>
        )}
      </div>

      {/* —— 选项内容 —— */}
      {needsOptions && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {t("选项内容")}
            </span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
              onClick={addOption}
            >
              <Plus className="size-3" />
              {t("添加选项")}{" "}
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {missingOptions && (
              <p className="px-1 text-[11px] text-muted-foreground">
                {t("至少填一个选项名称才能保存。")}{" "}
              </p>
            )}
            {draft.options.map((option, index) => (
              <div
                key={option.id}
                draggable
                onDragStart={() => setDraggingOptionId(option.id)}
                onDragEnd={() => setDraggingOptionId(null)}
                onDragOver={(event) => {
                  if (draggingOptionId) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  moveOption(option.id);
                  setDraggingOptionId(null);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-1 py-0.5",
                  draggingOptionId === option.id && "opacity-50",
                )}
              >
                <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground" />
                <ColorSwatchButton
                  label={
                    option.name ||
                    translate("选项 {value1}", { value1: index + 1 })
                  }
                  color={option.color}
                  onChange={(color) => setOption(option.id, { color })}
                />
                <Input
                  value={option.name}
                  aria-label={translate("选项 {value1}", { value1: index + 1 })}
                  placeholder={t("选项名称")}
                  className="h-7 min-w-0 flex-1 text-xs md:text-xs"
                  onChange={(event) =>
                    setOption(option.id, { name: event.target.value })
                  }
                />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={translate("删除选项 {value1}", {
                    value1: option.name || index + 1,
                  })}
                  className="text-muted-foreground"
                  onClick={() => removeOption(option.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* —— 默认值 —— */}
      {showDefault && (
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="dv-field-default"
            className="text-[11px] text-muted-foreground"
          >
            {draft.type === "date" ? t("时间格式") : t("默认值")}
          </Label>
          {draft.type === "date" ? (
            <Select
              value={draft.includeTime ? "time" : "date"}
              onValueChange={(value) =>
                patch({ includeTime: value === "time" })
              }
            >
              <SelectTrigger
                size="sm"
                aria-label={t("时间格式")}
                className="h-8 w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">{t("不带分时")}</SelectItem>
                <SelectItem value="time">{t("带分时")}</SelectItem>
              </SelectContent>
            </Select>
          ) : draft.type === "checkbox" ? (
            <div className="flex h-8 items-center">
              <Switch
                id="dv-field-default"
                checked={draft.defaultChecked}
                onCheckedChange={(checked) =>
                  patch({ defaultChecked: checked })
                }
              />
            </div>
          ) : draft.type === "multiSelect" ? (
            <div className="flex flex-wrap gap-1">
              {namedOptions.length === 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {t("先添加选项")}{" "}
                </span>
              )}
              {namedOptions.map((option) => {
                const checked = draft.defaultOptionIds.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={checked}
                    className={cn(
                      "flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px]",
                      checked
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground",
                    )}
                    onClick={() =>
                      patch({
                        defaultOptionIds: checked
                          ? draft.defaultOptionIds.filter(
                              (entry) => entry !== option.id,
                            )
                          : [...draft.defaultOptionIds, option.id],
                      })
                    }
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ background: option.color }}
                    />
                    {option.name}
                  </button>
                );
              })}
            </div>
          ) : draft.type === "select" ? (
            <Select
              value={draft.defaultText || NONE}
              disabled={namedOptions.length === 0}
              onValueChange={(value) =>
                patch({ defaultText: value === NONE ? "" : value })
              }
            >
              <SelectTrigger
                size="sm"
                aria-label={t("默认值")}
                className="h-8 w-full py-1 text-xs"
              >
                <SelectValue placeholder={t("请选择选项")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} className="text-xs">
                  {t("不设置")}{" "}
                </SelectItem>
                {namedOptions.map((option) => (
                  <SelectItem
                    key={option.id}
                    value={option.id}
                    className="text-xs"
                  >
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="dv-field-default"
              value={draft.defaultText}
              type={draft.type === "number" ? "number" : "text"}
              placeholder={t("留空表示不设置")}
              className="h-8 text-xs md:text-xs"
              onChange={(event) => patch({ defaultText: event.target.value })}
            />
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-0.5">
        {onCancel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs font-normal"
            onClick={onCancel}
          >
            {t("取消")}{" "}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit}
          className="h-7 px-3 text-xs font-normal"
          onClick={submit}
        >
          {t("确定")}{" "}
        </Button>
      </div>
    </div>
  );
}

/**
 * The field editor as the body of a 字段编辑 dropdown.
 *
 * Rendered inside a `DropdownMenuContent`, which owns both the anchoring and the
 * dismissal — the panel is where the menu that opened it was, with no rect maths
 * anywhere. Two details matter when a *form* lives in a menu:
 *
 * - the content must not steal focus on open, or the 标题 input loses it to the
 *   menu itself (the host passes `onOpenAutoFocus` that prevents the default);
 * - Radix only handles arrow keys when the content node itself is focused and
 *   only runs typeahead over `[role=menuitem]` items — this body has none, so
 *   typing, caret keys and Tab all behave like a normal form.
 *
 * `key` on the editor (not just the conditional) means every visit starts from a
 * fresh draft instead of the previous edit's leftovers.
 */
export function FieldEditorMenuContent({
  field,
  fields,
  onCancel,
  onSubmit,
  className,
}: {
  field?: DatabaseField;
  fields: readonly DatabaseField[];
  onCancel?: () => void;
  onSubmit: (next: FieldEditResult) => void;
  className?: string;
}) {
  const { t } = useI18n();

  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * Claim the caret for the 标题 input.
   *
   * The menu focuses its own content when it opens and re-focuses it whenever the
   * pointer leaves an item (which is exactly what happens when the item list is
   * swapped out for this form), so the input's own `autoFocus` is not enough on
   * its own — the next keystroke would go nowhere.
   */
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector("input")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={rootRef} className={cn("flex flex-col gap-2", className)}>
      <span className="px-0.5 text-xs font-medium">
        {field ? t("编辑字段") : t("新增字段")}
      </span>
      <FieldEditor
        key={field?.id ?? "new"}
        field={field}
        fields={fields}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </div>
  );
}
