// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useState } from "react";
import { DateTimeInput } from "../../../shared/date-time-input";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  InputEditor,
  type EditContext,
  type IEditor,
  type RectProps,
} from "@visactor/vtable-editors";
import type { ListTable } from "@visactor/vtable";
import { Input } from "@workspace/ui/components/ui/input";
import { Button } from "@workspace/ui/components/ui/button";
import { Calendar } from "@workspace/ui/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import { useI18n } from "@workspace/ui/lib/i18n";
import { CalendarDays } from "lucide-react";
import {
  parseFieldDate,
  toFieldDate,
  formatFieldDate,
} from "../../../shared/field-value";

/** Keep VTable's text entry lifecycle, but render the shared input skin. */
export class TableInputEditor extends InputEditor {
  private root?: Root;
  private host?: HTMLDivElement;

  createElement() {
    const host = document.createElement("div");
    host.style.display = "contents";
    this.container.appendChild(host);
    this.host = host;
    this.root = createRoot(host);
    flushSync(() => {
      this.root?.render(
        <Input
          ref={(element) => {
            this.element = element ?? undefined;
          }}
          readOnly={this.editorConfig?.readonly}
          className="absolute z-10 rounded-none border-0 bg-background px-2.5 py-0 text-xs shadow-none transition-none focus-visible:ring-0 dark:bg-background"
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "a"
            )
              event.stopPropagation();
          }}
          onPaste={(event) => {
            if (this.element?.style.opacity === "0") event.preventDefault();
          }}
        />,
      );
    });
  }

  onStart(context: EditContext<string, ListTable>) {
    super.onStart(context);
    if (this.element) applyCellStyle(this.element, context);
  }

  adjustPosition(rect: RectProps) {
    if (!this.element) return;
    // Leave VTable's selection outline visible around the editing cell.
    positionInsideCell(this.element, rect);
  }

  onEnd() {
    this.root?.unmount();
    this.root = undefined;
    this.host?.remove();
    this.host = undefined;
    super.onEnd();
  }
}

/** A canvas cell anchors a React popover; portal clicks remain inside the editor. */
export class TableDateEditor implements IEditor<string> {
  constructor(private readonly includeTime = false) {}

  private root?: Root;
  private host?: HTMLDivElement;
  private content: HTMLDivElement | null = null;
  private value = "";
  private initialValue = "";
  private endEdit?: () => void;

  onStart({
    container,
    referencePosition,
    value,
    endEdit,
    table,
    col,
    row,
  }: EditContext<string, ListTable>) {
    this.onEnd();
    const rawValue = table.getCellRawValue(col, row);
    this.value = this.initialValue = String(rawValue ?? value ?? "");
    this.endEdit = endEdit;
    this.host = document.createElement("div");
    this.host.className = "absolute z-10";
    container.appendChild(this.host);
    this.adjustPosition(referencePosition.rect);
    applyCellStyle(this.host, { table, col, row });
    this.root = createRoot(this.host);
    flushSync(() => {
      this.root?.render(
        <DateEditorContent
          portalContainer={container.closest<HTMLElement>(
            '[data-slot="dialog-content"]',
          )}
          includeTime={this.includeTime}
          value={this.value}
          contentRef={(element) => {
            this.content = element;
          }}
          onChange={(next) => {
            this.value = next;
            if (!this.includeTime || !next) this.finish();
          }}
          onClose={() => this.finish()}
          onCancel={() => {
            this.value = this.initialValue;
            this.finish();
          }}
        />,
      );
    });
  }

  private finish() {
    const endEdit = this.endEdit;
    // Finish after the entire click has propagated, so the dialog never sees
    // a calendar target that was already detached during the same gesture.
    setTimeout(() => {
      if (this.endEdit === endEdit) endEdit?.();
    }, 0);
  }

  adjustPosition(rect: RectProps) {
    if (!this.host) return;
    positionInsideCell(this.host, rect);
  }

  getValue() {
    return this.value;
  }

  getInputElement() {
    return this.host?.querySelector("button") ?? this.host!;
  }

  isEditorElement(target: HTMLElement) {
    return Boolean(
      this.host?.contains(target) || this.content?.contains(target),
    );
  }

  onEnd() {
    this.endEdit = undefined;
    this.root?.unmount();
    this.root = undefined;
    this.host?.remove();
    this.host = undefined;
    this.content = null;
  }
}

function DateEditorContent({
  includeTime,
  portalContainer,
  value,
  contentRef,
  onChange,
  onClose,
  onCancel,
}: {
  includeTime: boolean;
  portalContainer: HTMLElement | null;
  value: string;
  contentRef: (element: HTMLDivElement | null) => void;
  onChange: (value: string) => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const selected = parseFieldDate(draft);
  const change = (next: string) => {
    setDraft(next);
    onChange(next);
  };
  return (
    <Popover
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-full w-full justify-start rounded-none border-0 bg-transparent px-2.5 text-xs font-normal shadow-none hover:bg-transparent focus-visible:ring-0"
          style={{
            color: "inherit",
            fontFamily: "inherit",
            fontSize: "inherit",
          }}
        >
          <CalendarDays className="size-3.5 text-muted-foreground" />
          {formatFieldDate(draft, includeTime) || t("选择日期")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        container={portalContainer}
        align="start"
        className="w-auto p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={onCancel}
      >
        <Calendar
          mode="single"
          autoFocus
          selected={selected ?? undefined}
          defaultMonth={selected ?? undefined}
          onSelect={(date) => {
            if (date) {
              date.setHours(
                selected?.getHours() ?? 0,
                selected?.getMinutes() ?? 0,
                0,
                0,
              );
              change(toFieldDate(date, includeTime));
            }
          }}
        />
        {includeTime && (
          <DateTimeInput
            date={selected}
            onChange={(date) => change(toFieldDate(date, true))}
          />
        )}
        <div className="flex justify-end border-t p-2">
          {includeTime && (
            <Button type="button" size="sm" onClick={onClose}>
              {t("确定")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
          >
            {t("清除日期")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Match the canvas instead of applying the app's larger form-field styling. */
function applyCellStyle(
  element: HTMLElement,
  {
    table,
    col,
    row,
  }: Pick<EditContext<string, ListTable>, "table" | "col" | "row">,
) {
  const style = table.getCellStyle(col, row);
  if (typeof style.bgColor === "string")
    element.style.backgroundColor = style.bgColor;
  if (typeof style.color === "string") element.style.color = style.color;
  if (typeof style.fontSize === "number")
    element.style.fontSize = `${style.fontSize}px`;
  if (typeof style.fontFamily === "string")
    element.style.fontFamily = style.fontFamily;
  if (
    typeof style.fontWeight === "string" ||
    typeof style.fontWeight === "number"
  )
    element.style.fontWeight = String(style.fontWeight);
}

function positionInsideCell(element: HTMLElement, rect: RectProps) {
  Object.assign(element.style, {
    left: `${rect.left + 1}px`,
    top: `${rect.top + 1}px`,
    width: `${Math.max(0, rect.width - 2)}px`,
    height: `${Math.max(0, rect.height - 2)}px`,
  });
}
