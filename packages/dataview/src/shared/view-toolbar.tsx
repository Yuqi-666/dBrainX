// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The view toolbar strip — the one place a view puts its controls.
 *
 * The design change (docs/propmt/dataview-table-1.md) retired the side config
 * panel: view configuration is now a set of buttons + dropdown menus living in
 * the view's own toolbar, **config on the left, functions on the right**.
 *
 * `ViewConfigMenu` is the generic escape hatch every view can reuse: it renders
 * the view's own lazy `configEditor` (resolved through the registry, so it stays
 * the single dispatch table) inside a popover instead of a sidebar. The table
 * view builds dedicated menus for its own config and only uses this for the
 * settings that have no dedicated control.
 */
import { Suspense, type HTMLAttributes, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import { ScrollArea } from "@workspace/ui/components/ui/scroll-area";
import { Skeleton } from "@workspace/ui/components/ui/skeleton";
import type {
  DataViewConfig,
  DataViewSource,
  DataViewType,
} from "@workspace/interfaces";

import { getDataViewDescriptor } from "../registry";
import { useViewActions } from "../toolbar/view-actions";

/**
 * A view's control strip: `children` on the left (config), `actions` right.
 *
 * Layout contract (same as the table's own toolbar): the outer row never wraps
 * — the configuration group reflows *inside itself* (`flex-1 min-w-0
 * flex-wrap`) while the function group is `h-7 shrink-0` pinned to the right.
 * Wrapping the whole strip let the right-hand controls flip between line 1 and
 * line 2 near a width threshold, and any control whose size changed on
 * re-render (a counter, a button that appears with a selection) dragged its
 * neighbours around with it.
 *
 * The shell's 更多 menu (设为默认视图 / 复制视图 / 删除视图) is appended to the
 * function group automatically, so every view that draws a `ViewToolbar`
 * carries the view actions without knowing about them.
 */
export function ViewToolbar({
  children,
  actions,
  className,
  ...rest
}: {
  /** View *configuration* controls — left aligned. */
  children?: ReactNode;
  /** View *functions* (search, export, …) — right aligned. */
  actions?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  useI18n();

  const viewActions = useViewActions();
  return (
    <div
      {...rest}
      className={cn(
        "flex min-h-9 shrink-0 items-start gap-1.5 border-b border-border bg-background px-2 py-1 text-xs",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {children}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-2">
        {actions}
        {viewActions}
      </div>
    </div>
  );
}

export interface ViewConfigMenuProps {
  type: DataViewType;
  config: DataViewConfig;
  source: DataViewSource;
  readOnly?: boolean;
  /** Absent when the host does not allow view management → control disabled. */
  onConfigChange?: (config: DataViewConfig) => void;
  label?: string;
  className?: string;
}

/**
 * "视图配置" as a popover hosting the view's registered config editor.
 *
 * The editor is loaded lazily exactly like the renderer, so a view type's
 * config UI still travels with its implementation and `DataViewRoot` never
 * switches on the view type. A view that configures itself entirely from its
 * toolbar (the table) registers no editor, and this renders nothing.
 */
export function ViewConfigMenu({
  type,
  config,
  source,
  readOnly,
  onConfigChange,
  label = translate("视图配置"),
  className,
}: ViewConfigMenuProps) {
  useI18n();

  const ConfigEditor = getDataViewDescriptor(type).configEditor;
  const disabled = !onConfigChange;

  if (!ConfigEditor) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={label}
          className={cn(
            "h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground",
            className,
          )}
        >
          <Settings2 className="size-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <ScrollArea className="max-h-[70vh]">
          <Suspense
            fallback={
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-24 w-full" />
              </div>
            }
          >
            <ConfigEditor
              config={config}
              source={source}
              readOnly={readOnly}
              onChange={(next) => onConfigChange?.(next)}
            />
          </Suspense>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
