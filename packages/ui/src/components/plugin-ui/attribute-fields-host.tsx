// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The shared attribute-panel host (§3.5.4.6).
 *
 * It draws the fields a node type's descriptor declares and nothing else, so
 * adding a field to a plugin type needs no change here. A type no plugin
 * registered renders a short notice and an empty panel instead of throwing; a
 * registered type that declares no field renders nothing at all.
 *
 * Edits are kept in a local draft and raised through `onFieldChange`; the
 * caller decides where they go (todo 39 makes that an `operation.invoke`).
 * Nothing here builds a whole `content` object.
 */
import { useState } from "react";
import type { ReactElement } from "react";
import type {
  NodeAttributeField,
  NodeAttributeFieldKind,
} from "@workspace/plugin-sdk/ui";
import {
  AlignLeft,
  Clock,
  Image as ImageIcon,
  LayoutGrid,
  LinkIcon,
} from "lucide-react";

import { useI18n } from "../../lib/i18n";
import {
  attributeTimelineCount,
  isNodeTypeRegistered,
  readAttributeValue,
  resolveAttributeFields,
} from "../../lib/node-attribute-fields";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export interface AttributeFieldsHostProps {
  /** The node type whose descriptor contributes the fields. */
  type: string;
  /** The node's `content`; each field reads its dotted path out of it. */
  content: unknown;
  /** Raised once per edit, with the declaration that produced the control. */
  onFieldChange?: (field: NodeAttributeField, value: string) => void;
  className?: string;
}

interface FieldControlProps {
  field: NodeAttributeField;
  value: unknown;
  onChange: (value: string) => void;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function TextControl({ field, value, onChange }: FieldControlProps) {
  return (
    <Input
      value={textOf(value)}
      placeholder={field.placeholder}
      aria-label={field.label}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 text-xs"
    />
  );
}

function SelectControl({ field, value, onChange }: FieldControlProps) {
  return (
    <Select value={textOf(value)} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs" aria-label={field.label}>
        <SelectValue placeholder={field.placeholder ?? field.label} />
      </SelectTrigger>
      <SelectContent>
        {(field.options ?? []).map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TimelineControl({ field, value }: FieldControlProps) {
  const { t } = useI18n();
  const count = attributeTimelineCount(value);
  return (
    <p
      data-attribute-timeline={field.field}
      className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
    >
      <span className="truncate">{t("在媒体侧栏中编辑")}</span>
      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground">
        {count} {t("records")}
      </span>
    </p>
  );
}

const FIELD_CONTROLS: Record<
  NodeAttributeFieldKind,
  (props: FieldControlProps) => ReactElement
> = {
  url: TextControl,
  text: TextControl,
  cover: TextControl,
  select: SelectControl,
  timeline: TimelineControl,
};

const FIELD_ICONS: Record<NodeAttributeFieldKind, typeof LinkIcon> = {
  url: LinkIcon,
  text: AlignLeft,
  cover: ImageIcon,
  select: LayoutGrid,
  timeline: Clock,
};

export function AttributeFieldsHost({
  type,
  content,
  onFieldChange,
  className,
}: AttributeFieldsHostProps) {
  const { t } = useI18n();
  const fields = resolveAttributeFields(type);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (!isNodeTypeRegistered(type)) {
    return (
      <div
        data-attribute-fields-empty=""
        data-node-type={type}
        className={cn(
          "flex flex-col gap-1 rounded-lg border border-dashed p-3 text-xs text-muted-foreground",
          className,
        )}
      >
        <span>{t("该类型未注册属性面板")}</span>
        <span className="font-mono text-[11px] text-muted-foreground/70">
          {type}
        </span>
      </div>
    );
  }

  if (fields.length === 0) return null;

  return (
    <div className={cn("space-y-4", className)} data-attribute-fields={type}>
      {fields.map((field) => {
        const Icon = FIELD_ICONS[field.kind];
        const Control = FIELD_CONTROLS[field.kind];
        const value = drafts[field.field] ?? readAttributeValue(content, field.field);
        return (
          <div
            key={field.field}
            className="space-y-1.5"
            data-attribute-field={field.field}
            data-optional={field.optional ? "" : undefined}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Icon className="size-3.5 shrink-0" />
              {field.label}
              {field.optional && (
                <span className="text-[10px] text-muted-foreground/70">
                  {t("可选")}
                </span>
              )}
            </span>
            <Control
              field={field}
              value={value}
              onChange={(next) => {
                setDrafts((previous) => ({ ...previous, [field.field]: next }));
                onFieldChange?.(field, next);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
