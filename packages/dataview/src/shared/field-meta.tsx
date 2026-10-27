// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The workspace's field vocabulary: type labels and icons, the palettes behind
 * option dots and 填色 rules, and the query matcher behind every "search a
 * field" dropdown.
 *
 * It lives in `shared/` (not in `views/table/fields/`) because it is not the
 * table's private chrome: the table's 字段配置 / 筛选 / 分组 / 排序 / 填色 menus
 * and the kanban's lane/option editors all speak the same field vocabulary, and
 * "the colour of an option" must mean one thing across views. Nothing here
 * imports React state or a third-party library, so any view may use it.
 */
import {
  Calendar,
  CircleDot,
  GitBranch,
  Hash,
  Link2,
  ListChecks,
  SquareCheck,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  DatabaseField,
  DatabaseFieldOption,
  DatabaseFieldType,
} from "@workspace/interfaces";

export const FIELD_TYPE_LABELS: Record<DatabaseFieldType, string> = {
  get text() {
    return translate("文本");
  },
  get number() {
    return translate("数字");
  },
  get select() {
    return translate("单选");
  },
  get multiSelect() {
    return translate("多选");
  },
  get date() {
    return translate("日期");
  },
  get checkbox() {
    return translate("勾选");
  },
  get url() {
    return translate("链接");
  },
  get relation() {
    return translate("关联");
  },
};

export const FIELD_TYPE_ICONS: Record<DatabaseFieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  select: CircleDot,
  multiSelect: ListChecks,
  date: Calendar,
  checkbox: SquareCheck,
  url: Link2,
  relation: GitBranch,
};

/** The icon a field type shows in pickers, menus and the header menu. */
export function FieldTypeIcon({
  type,
  className,
}: {
  type: DatabaseFieldType;
  className?: string;
}) {
  useI18n();

  const Icon = FIELD_TYPE_ICONS[type] ?? Type;
  return <Icon className={className} />;
}

/** Field types that carry an option list (编辑字段 shows 选项内容 for these). */
export function fieldHasOptions(type: DatabaseFieldType): boolean {
  return type === "select" || type === "multiSelect";
}

/** Case-insensitive substring match; an empty query matches everything. */
export function matchesText(text: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return text.toLocaleLowerCase().includes(needle);
}

/** Case-insensitive name/id match used by every field search box. */
export function matchesFieldQuery(
  field: DatabaseField,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return (
    field.name.toLocaleLowerCase().includes(needle) ||
    field.id.toLocaleLowerCase().includes(needle) ||
    FIELD_TYPE_LABELS[field.type].includes(needle)
  );
}

/** Filter a field list by the search box. */
export function filterFieldsByQuery(
  fields: readonly DatabaseField[],
  query: string,
): DatabaseField[] {
  return fields.filter((field) => matchesFieldQuery(field, query));
}

/**
 * Saturated swatches for select / multiSelect option dots — the same intensity
 * the screenshots use for option colours.
 */
export const OPTION_COLORS = [
  "#94a3b8",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

/**
 * Soft tints for 填色 backgrounds.
 *
 * A conditional fill sets the cell's `bgColor` only, so a tint keeps the
 * themed text colour readable — a saturated background would make dark-mode
 * text illegible.
 */
export const FILL_COLORS = [
  "#fef3c7",
  "#fee2e2",
  "#ffedd5",
  "#dcfce7",
  "#ccfbf1",
  "#dbeafe",
  "#ede9fe",
  "#fce7f3",
  "#e2e8f0",
] as const;

/** Palette entry used when a new option / rule has no colour yet. */
export const DEFAULT_FILL_COLOR = FILL_COLORS[0];

/** Deterministic swatch for an option that never declared a colour. */
export function fallbackOptionColor(index: number): string {
  return OPTION_COLORS[index % OPTION_COLORS.length]!;
}

/** The colour an option renders with, resolved through the palette. */
export function resolveOptionColor(
  option: DatabaseFieldOption,
  index: number,
): string {
  return option.color ?? fallbackOptionColor(index);
}
