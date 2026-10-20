// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { getLocale } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

import { translate } from "@workspace/ui/lib/i18n/runtime";

/**
 * The one place a cell becomes *pixels*.
 *
 * Every DOM surface in this package renders a field value through here — the
 * record editor, the kanban card, the gallery card, the calendar readout — so
 * "what does a 单选 look like" has exactly one answer: a shadcn `Badge` tinted
 * with the option's own colour (dataview/AGENTS.md § UI conventions). The table
 * is the exception, because its cells live on a canvas and cannot mount a React
 * component; `views/table/canvas/pill.ts` mirrors this file's rules with canvas
 * primitives.
 *
 * Read-only by design: editing a value is `FieldInput`'s job (see
 * `shared/field-input.tsx`), which composes the same badges with a picker.
 */
import type { ReactNode } from "react";
import { Check, ExternalLink } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Badge } from "@workspace/ui/components/ui/badge";
import type {
  DatabaseCell,
  DatabaseField,
  DatabaseFieldOption,
  NodeId,
} from "@workspace/interfaces";

import { findOption, toNodeIds, toOptionIds } from "../source/cell-resolver";
import { resolveOptionColor } from "./field-meta";
import { tintColor } from "./color";

/** The character an empty cell shows wherever a value is expected. */
export const EMPTY_VALUE_TEXT = "—";

/** A date cell parsed as a *calendar day* when it carries no time. */
export function parseFieldDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const date = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      )
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `YYYY-MM-DD` for a `date` cell — the shape the domain persists. */
export function toISODate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The locale text a `date` cell shows in a read-only surface. */
export function formatFieldDate(
  value: string | null | undefined,
  includeTime = false,
): string {
  const date = parseFieldDate(value);
  if (!date) return "";
  return includeTime
    ? date.toLocaleString(getLocale(), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : date.toLocaleDateString(getLocale());
}

/**
 * A tinted option badge — the unified look of a 单选 / 多选 value.
 *
 * The tint (not a solid fill) keeps the theme's text colour readable in both
 * modes; the leading dot survives a colour-blind reading and a greyscale print.
 */
export function OptionBadge({
  label,
  color,
  className,
  title,
  onRemove,
  children,
}: {
  label: string;
  /** The declared option colour; omitted → a neutral badge. */
  color?: string | undefined;
  className?: string;
  title?: string;
  /** Renders a "×" affordance inside the badge (the editor's removable chips). */
  onRemove?: (() => void) | undefined;
  children?: ReactNode;
}) {
  useI18n();

  const tint = color ? tintColor(color, 0.16) : undefined;
  const border = color ? tintColor(color, 0.4) : undefined;

  return (
    <Badge
      variant="outline"
      title={title ?? label}
      style={tint ? { backgroundColor: tint, borderColor: border } : undefined}
      className={cn(
        "max-w-full gap-1 rounded-md py-0.5 text-[11px] font-normal",
        !tint && "bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      {color && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="truncate">{label}</span>
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label={translate("移除 {value1}", { value1: label })}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          <span aria-hidden className="block text-[10px] leading-none">
            ×
          </span>
        </button>
      )}
    </Badge>
  );
}

/** Every option id a cell carries, paired with its live option (if any). */
export function cellOptionBadges(
  cell: DatabaseCell | undefined,
  field: DatabaseField | undefined,
): Array<{ id: string; label: string; color: string }> {
  const optionIds = toOptionIds(cell);
  if (optionIds.length === 0) return [];
  const options = field?.options ?? [];
  return optionIds.map((optionId, index) => {
    const option: DatabaseFieldOption | undefined = findOption(field, optionId);
    const optionIndex = options.findIndex((entry) => entry.id === optionId);
    return {
      id: optionId,
      label: option?.name ?? optionId,
      color: option
        ? resolveOptionColor(option, optionIndex)
        : resolveOptionColor({ id: optionId, name: optionId }, index),
    };
  });
}

/** Renders a `relation` cell as badges; `onOpenNode` makes them links. */
function RelationValue({
  cell,
  resolveNodeTitle,
  onOpenNode,
}: {
  cell: DatabaseCell;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  onOpenNode?: (nodeId: NodeId) => void;
}) {
  const nodeIds = toNodeIds(cell);
  if (nodeIds.length === 0) return <EmptyValue />;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {nodeIds.map((nodeId) => {
        const label = resolveNodeTitle?.(nodeId) ?? nodeId;
        const badge = (
          <OptionBadge label={label} className="gap-1">
            {onOpenNode && <ExternalLink className="size-3 opacity-60" />}
          </OptionBadge>
        );
        return onOpenNode ? (
          <button
            key={nodeId}
            type="button"
            className="cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              onOpenNode(nodeId);
            }}
          >
            {badge}
          </button>
        ) : (
          <span key={nodeId}>{badge}</span>
        );
      })}
    </span>
  );
}

/** The muted dash an empty cell shows. */
export function EmptyValue() {
  return <span className="text-muted-foreground">{EMPTY_VALUE_TEXT}</span>;
}

export interface FieldValueProps {
  cell: DatabaseCell | undefined;
  field: DatabaseField | undefined;
  /** Relation display names. */
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  /** When given, relation badges become buttons. */
  onOpenNode?: (nodeId: NodeId) => void;
  /** Rendered for an empty cell instead of the dash. */
  emptyFallback?: ReactNode;
  className?: string;
}

/**
 * One field's value, read-only.
 *
 * This is the DOM twin of the table's cell colours: text truncates, 单选/多选
 * become tinted badges, a checkbox is a check glyph, a date is locale text and
 * a URL is a real link. `url` and `text` share a renderer; `number` uses
 * tabular figures so columns of numbers line up.
 */
export function FieldValue({
  cell,
  field,
  resolveNodeTitle,
  onOpenNode,
  emptyFallback,
  className,
}: FieldValueProps) {
  useI18n();
  if (!cell || !field) {
    return <>{emptyFallback ?? <EmptyValue />}</>;
  }

  switch (field.type) {
    case "select":
    case "multiSelect": {
      const badges = cellOptionBadges(cell, field);
      if (badges.length === 0) return <>{emptyFallback ?? <EmptyValue />}</>;
      return (
        <span className={cn("flex flex-wrap items-center gap-1", className)}>
          {badges.map((badge) => (
            <OptionBadge
              key={badge.id}
              label={badge.label}
              color={badge.color}
            />
          ))}
        </span>
      );
    }
    case "checkbox":
      return cell.type === "checkbox" && cell.checked ? (
        <Check className={cn("size-3.5 text-primary", className)} />
      ) : (
        <>{emptyFallback ?? <EmptyValue />}</>
      );
    case "date": {
      const text =
        cell.type === "date"
          ? formatFieldDate(cell.date, field.includeTime)
          : "";
      return text ? (
        <span className={cn("tabular-nums", className)}>{text}</span>
      ) : (
        <>{emptyFallback ?? <EmptyValue />}</>
      );
    }
    case "number": {
      const value = cell.type === "number" ? cell.number : null;
      return value == null ? (
        <>{emptyFallback ?? <EmptyValue />}</>
      ) : (
        <span className={cn("tabular-nums", className)}>{value}</span>
      );
    }
    case "url": {
      const url = cell.type === "url" ? (cell.url ?? "") : "";
      if (!url) return <>{emptyFallback ?? <EmptyValue />}</>;
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "block max-w-full truncate text-primary underline-offset-2 hover:underline",
            className,
          )}
          title={url}
        >
          {url}
        </a>
      );
    }
    case "relation":
      return (
        <RelationValue
          cell={cell}
          resolveNodeTitle={resolveNodeTitle}
          onOpenNode={onOpenNode}
        />
      );
    case "text":
    default: {
      const text = cell.type === "text" ? (cell.text ?? "") : "";
      return text ? (
        <span className={cn("block max-w-full break-words", className)}>
          {text}
        </span>
      ) : (
        <>{emptyFallback ?? <EmptyValue />}</>
      );
    }
  }
}

/** Local calendar date and time, without an implicit UTC conversion. */
export function toFieldDate(date: Date, includeTime: boolean): string {
  const day = toISODate(date);
  if (!includeTime) return day;
  return `${day}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
