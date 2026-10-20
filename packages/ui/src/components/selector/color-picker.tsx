// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { useI18n } from "@workspace/ui/lib/i18n";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@workspace/ui/components/ui/tabs";

import {
  COLOR_PICKER_GROUPS,
  type ColorPickerColor,
  type ColorPickerGroup,
} from "@workspace/ui/lib/color-palette";

export { COLOR_PICKER_GROUPS } from "@workspace/ui/lib/color-palette";
export type {
  ColorPickerColor,
  ColorPickerGroup,
} from "@workspace/ui/lib/color-palette";

export interface ColorPickerProps {
  value?: string;
  onChange?: (color: string) => void;
  groups?: readonly ColorPickerGroup[];
  onClear?: () => void;
  clearLabel?: string;
  defaultColor?: ColorPickerColor;
  disabled?: boolean;
  className?: string;
  columns?: number;
  showLabels?: boolean;
  "aria-label"?: string;
}

/** Color families and swatches only. The consumer owns presentation and triggering. */
export function ColorPicker({
  value,
  onChange,
  groups = COLOR_PICKER_GROUPS,
  onClear,
  clearLabel,
  defaultColor,
  disabled,
  className,
  columns = 6,
  showLabels = false,
  "aria-label": ariaLabel,
}: ColorPickerProps) {
  const { t } = useI18n();
  const selectedGroup = groups.findIndex((group) =>
    group.colors.some(
      (color) => color.value.toLowerCase() === value?.toLowerCase(),
    ),
  );
  const [activeTab, setActiveTab] = useState(
    String(Math.max(selectedGroup, 0)),
  );
  const selectedColor = groups
    .flatMap((group) => group.colors)
    .find((color) => color.value.toLowerCase() === value?.toLowerCase());
  const currentColor: ColorPickerColor | undefined =
    selectedColor ??
    (value
      ? defaultColor?.value.toLowerCase() === value.toLowerCase()
        ? defaultColor
        : { value }
      : undefined);
  const label = ariaLabel ?? t("颜色");
  const swatch = (color: ColorPickerColor) => {
    const selected = value?.toLowerCase() === color.value.toLowerCase();
    const colorLabel = color.label ?? color.value;
    return (
      <button
        key={color.value}
        type="button"
        data-color-swatch
        aria-label={colorLabel}
        aria-pressed={selected}
        title={colorLabel}
        disabled={disabled}
        className={cn(
          "flex aspect-square w-full items-center justify-center rounded-lg border border-foreground/10 shadow-xs outline-none transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-popover",
        )}
        style={{ background: color.background ?? color.value }}
        onClick={() => onChange?.(color.value)}
      >
      </button>
    );
  };

  return (
    <div
      className={cn("w-full min-w-0 p-3", className)}
      role="group"
      aria-label={label}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t("色板")}
        </span>
        <span
          role="img"
          aria-label={
            currentColor?.label ?? value ?? clearLabel ?? t("默认颜色")
          }
          title={currentColor?.label ?? value ?? clearLabel ?? t("默认颜色")}
          className="flex size-5 items-center justify-center rounded-md border border-foreground/15 shadow-xs"
          style={
            currentColor
              ? { background: currentColor.background ?? currentColor.value }
              : undefined
          }
        >
          {!currentColor && <Ban className="size-3 text-muted-foreground" />}
        </span>
      </div>
      <Tabs
        value={groups[Number(activeTab)] ? activeTab : "0"}
        onValueChange={setActiveTab}
        className="gap-3"
      >
        {groups.length > 1 && (
          <TabsList
            aria-label={label}
            variant="line"
            className="w-full gap-0.5 rounded-xl bg-muted/50 p-1 group-data-horizontal/tabs:h-auto"
          >
            {groups.map((group, index) => {
              const representative =
                group.colors[Math.floor(group.colors.length / 2)];
              return (
                <TabsTrigger
                  key={group.label}
                  value={String(index)}
                  disabled={disabled}
                  title={t(group.label)}
                  aria-label={t(group.label)}
                  className="group h-8 min-w-0 flex-1 rounded-lg px-0 py-1 after:hidden data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  <span
                    aria-hidden
                    className="size-4 rounded-full border border-foreground/10 ring-offset-2 ring-offset-background group-data-[state=active]:ring-1"
                    style={{
                      background:
                        representative?.background ?? representative?.value,
                    }}
                  />
                  <span className="sr-only">{t(group.label)}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        )}
        {groups.map((group, index) => (
          <TabsContent
            key={group.label}
            value={String(index)}
            className="min-h-12"
            onKeyDown={(event) => {
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "[data-color-swatch]:not(:disabled)",
                ),
              );
              const current = buttons.indexOf(
                event.target as HTMLButtonElement,
              );
              if (current < 0) return;
              const offsets: Record<string, number> = {
                ArrowLeft: -1,
                ArrowRight: 1,
                ArrowUp: -columns,
                ArrowDown: columns,
              };
              const offset = offsets[event.key];
              if (
                offset === undefined &&
                event.key !== "Home" &&
                event.key !== "End"
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (current + (offset ?? 0) + buttons.length) %
                    buttons.length;
              buttons[next]?.focus();
            }}
          >
            <div
              className="grid gap-2 rounded-xl bg-muted/25 p-2"
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
              }}
            >
              {group.colors.map((color) => (
                <div key={color.value} className="min-w-0">
                  {swatch(color)}
                  {showLabels && (
                    <div
                      className="mt-1.5 truncate text-center text-[10px] text-muted-foreground"
                      title={color.label}
                    >
                      {color.label ?? color.value}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
      {(defaultColor || onClear) && (
        <div className="mt-3 flex items-center gap-2 border-t pt-3">
          {defaultColor && (
            <div className="w-7 shrink-0">{swatch(defaultColor)}</div>
          )}
          {onClear && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={onClear}
            >
              <Ban className="size-3.5" />
              {clearLabel ?? t("默认颜色")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
