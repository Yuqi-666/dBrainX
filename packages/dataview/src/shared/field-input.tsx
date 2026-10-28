// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";
import { translate } from "@workspace/ui/lib/i18n/runtime";

/**
 * The unified field editor control — one field type, one control.
 *
 * The record editor renders one `FieldInput` per field; nothing else in the
 * package builds a second text box for a `text` field or a second date picker
 * for a `date` field. The controls are "quiet": borderless until focused, so a
 * panel of them reads as a record rather than a form (the Notion-like look the
 * record editor is modelled on).
 *
 * The control is *controlled* by the cell it is given and reports the whole
 * next cell through `onChange`. Text-like controls keep a local draft and
 * commit on blur / Enter; the parent must therefore key the component per
 * record (`key={`${rowId}:${fieldId}`}`) so switching records re-seeds it.
 */
import { useRef } from "react";
import { cn } from "@workspace/ui/lib/utils";
import { Input } from "@workspace/ui/components/ui/input";
import { Switch } from "@workspace/ui/components/ui/switch";
import type {
  DatabaseCell,
  DatabaseField,
  NodeId,
} from "@workspace/interfaces";

import { DatePicker } from "./date-picker";
import { FieldValue } from "./field-value";
import { OptionPicker } from "./option-picker";

/** The quiet input skin every text-like control shares. */
const QUIET_INPUT =
  "h-7 border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted/60 focus-visible:border-input focus-visible:bg-background";

export interface FieldInputProps {
  field: DatabaseField;
  cell: DatabaseCell | undefined;
  /** Data read-only (collection projection) → values render, never edit. */
  readOnly?: boolean;
  onChange: (cell: DatabaseCell) => void;
  /** Adds an option to the field's schema and returns its new id. */
  onCreateOption?: (name: string) => string | undefined;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  onOpenNode?: (nodeId: NodeId) => void;
  className?: string;
}

export function FieldInput({
  field,
  cell,
  readOnly,
  onChange,
  onCreateOption,
  resolveNodeTitle,
  onOpenNode,
  className,
}: FieldInputProps) {
  useI18n();
  if (readOnly || field.type === "relation") {
    return (
      <div className={cn("flex min-h-7 items-center px-2 py-1", className)}>
        <FieldValue
          cell={cell}
          field={field}
          resolveNodeTitle={resolveNodeTitle}
          onOpenNode={onOpenNode}
        />
      </div>
    );
  }

  switch (field.type) {
    case "checkbox": {
      const checked = cell?.type === "checkbox" ? cell.checked : false;
      return (
        <div className={cn("flex min-h-7 items-center px-2", className)}>
          <Switch
            checked={checked}
            aria-label={field.name}
            onCheckedChange={(next) =>
              onChange({ type: "checkbox", checked: next })
            }
          />
        </div>
      );
    }
    case "date": {
      const value = cell?.type === "date" ? (cell.date ?? null) : null;
      return (
        <DatePicker
          includeTime={field.includeTime}
          value={value}
          className={className}
          onChange={(next) => onChange({ type: "date", date: next })}
        />
      );
    }
    case "select": {
      const optionIds =
        cell?.type === "select" && cell.optionId ? [cell.optionId] : [];
      return (
        <OptionPicker
          field={field}
          value={optionIds}
          multiple={false}
          className={className}
          onCreateOption={onCreateOption}
          onChange={(ids) =>
            onChange({ type: "select", optionId: ids[0] ?? null })
          }
        />
      );
    }
    case "multiSelect": {
      const optionIds =
        cell?.type === "multiSelect" ? (cell.optionIds ?? []) : [];
      return (
        <OptionPicker
          field={field}
          value={optionIds}
          multiple
          className={className}
          onCreateOption={onCreateOption}
          onChange={(ids) => onChange({ type: "multiSelect", optionIds: ids })}
        />
      );
    }
    case "number": {
      const value =
        cell?.type === "number" && cell.number != null
          ? String(cell.number)
          : "";
      return (
        <NumberInput
          value={value}
          className={className}
          onCommit={(next) => onChange({ type: "number", number: next })}
        />
      );
    }
    case "url": {
      const value = cell?.type === "url" ? (cell.url ?? "") : "";
      return (
        <DraftInput
          value={value}
          placeholder="https://"
          className={className}
          onCommit={(next) => onChange({ type: "url", url: next || null })}
        />
      );
    }
    case "text":
    default: {
      const value = cell?.type === "text" ? (cell.text ?? "") : "";
      return (
        <DraftInput
          value={value}
          placeholder={translate("空")}
          className={className}
          onCommit={(next) => onChange({ type: "text", text: next })}
        />
      );
    }
  }
}

/** A text box that reports on blur / Enter, not on every keystroke. */
function DraftInput({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  className?: string;
  onCommit: (next: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <Input
      ref={ref}
      defaultValue={value}
      placeholder={placeholder}
      className={cn(QUIET_INPUT, className)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          ref.current?.blur();
        }
        if (event.key === "Escape") {
          if (ref.current) ref.current.value = value;
          ref.current?.blur();
        }
      }}
      onBlur={(event) => {
        const next = event.target.value;
        if (next !== value) onCommit(next);
      }}
    />
  );
}

/** A number box; an empty value is "no number", not `0`. */
function NumberInput({
  value,
  className,
  onCommit,
}: {
  value: string;
  className?: string;
  onCommit: (next: number | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const commit = () => {
    const raw = ref.current?.value ?? "";
    const parsed = raw.trim() === "" ? null : Number(raw);
    const next = parsed == null || Number.isNaN(parsed) ? null : parsed;
    if (String(next ?? "") !== value) onCommit(next);
  };

  return (
    <Input
      ref={ref}
      type="number"
      inputMode="decimal"
      defaultValue={value}
      className={cn(QUIET_INPUT, "tabular-nums", className)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          ref.current?.blur();
        }
      }}
      onBlur={commit}
    />
  );
}
