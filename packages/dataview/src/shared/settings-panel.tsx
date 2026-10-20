// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The vocabulary every view's settings popover is built from.
 *
 * A view whose settings are a **form** (a `Select`, a checkbox list, switches)
 * takes a `Popover` panel rather than a `DropdownMenu` — a menu's roving focus
 * is the wrong tool for a body full of inputs. Those panels all share the same
 * three pieces, so they live here instead of being rebuilt per view (the kanban
 * and the calendar both use them; the table's menus are command lists and do
 * not).
 *
 * Layout: one labelled block per section, a hint under the control it explains,
 * and a switch row whose label sits left and whose control sits right.
 */
import type { ComponentType, ReactNode } from "react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import { Checkbox } from "@workspace/ui/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import { Switch } from "@workspace/ui/components/ui/switch";

/** One labelled block inside a settings panel. */
export function PanelSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[11px] leading-relaxed text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}

/** A switch row: the label on the left, the control on the right. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3",
        disabled && "opacity-60",
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-foreground">{label}</span>
        {hint && (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        )}
      </span>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
    </label>
  );
}

/**
 * A toolbar button that opens a settings panel.
 *
 * The trigger is **neutral chrome**: every panel is one button of the same
 * shape, and a tinted trigger said nothing a user could act on (an engaged
 * setting is already visible in the panel itself, or in the value next to the
 * label). Only the current value is shown, and the button's width therefore
 * changes with it, which is fine because every control in a view toolbar's
 * configuration group is left-aligned (`shared/view-toolbar.tsx`).
 */
export function SettingsPanel({
  label,
  icon: Icon,
  value,
  disabled,
  width = "w-64",
  className,
  children,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Current value shown next to the label (e.g. the mapped field's name). */
  value?: string;
  disabled?: boolean;
  /** Panel width class; the field-mapping panels need more room than a switch. */
  width?: string;
  /** Extra classes for the trigger button (a view's own spacing). */
  className?: string;
  children: ReactNode;
}) {
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
            className,
          )}
        >
          <Icon className="size-3.5" />
          {label}
          {value && (
            <span className="max-w-28 truncate text-foreground">{value}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(width, "p-3")}>
        {/**
         * The body scrolls, capped by the height the popover actually has.
         *
         * A panel is as tall as its sections plus the field list, and a *field
         * list* grows with the schema — five role sections plus a dozen fields is
         * taller than the window, and a popover with `overflow: visible` simply
         * loses the bottom (measured: a 624px body in a 633px viewport, its
         * 新增字段 footer unreachable). The cap is Radix's own available height,
         * so a panel in a short dialog window still scrolls instead of spilling.
         */}
        <div className="flex max-h-[min(70vh,var(--radix-popover-content-available-height))] flex-col gap-3 overflow-y-auto">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A checkbox list of arbitrary options, used by the "which buttons" settings. */
export function CheckboxOptionList<T extends string>({
  options,
  selected,
  disabled,
  onToggle,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: readonly T[];
  disabled?: boolean;
  onToggle: (value: T, checked: boolean) => void;
}) {
  const chosen = new Set(selected);
  return (
    <div className="flex flex-col gap-0.5">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent/60"
        >
          <Checkbox
            checked={chosen.has(option.value)}
            disabled={disabled}
            aria-label={option.label}
            onCheckedChange={(checked) =>
              onToggle(option.value, checked === true)
            }
          />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
