// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { CSSProperties, ReactNode } from "react";
import { Command } from "@workspace/ui/components/ui/command";
import { useDialogContentContainer } from "@workspace/ui/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import { Button } from "@workspace/ui/components/ui/button";
import { cn } from "@workspace/ui/lib/utils";

export interface SelectorPopoverTab {
  /** Stable id — `emoji` / `icon` / `upload` / `node`. */
  value: string;
  label: string;
}

export interface SelectorPopoverShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger, rendered `asChild`; pass the real button. */
  trigger: ReactNode;
  tabs: SelectorPopoverTab[];
  activeTab: string;
  onTabChange: (value: string) => void;
  /**
   * Right-anchored verbs of the tab row (e.g. 移除). Always present and merely
   * `disabled` when unusable — a control that appears and disappears pushes its
   * left-hand neighbours around (sel §5 清除).
   */
  actions?: ReactNode;
  /** Panel width: `320` for the icon selector, `420` for the cover selector. */
  width?: number;
  /** Body ceiling: `min(384px, 52vh)` / `min(360px, 52vh)`. */
  bodyMaxHeight?: string;
  /**
   * **Pinned below the body**, i.e. outside its scrollport (the icon selector's
   * 底色 row). A row passed as `children` scrolls with the body and can therefore
   * sit out of sight under the fold on a long grid tab — G2-r1 第 1 轮的
   * 「底色只在上传 tab 有了」现场。 The caller styles it (`shrink-0` is what keeps
   * it from being squashed by the popover's column layout).
   */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SelectorPopoverShell({
  open,
  onOpenChange,
  trigger,
  tabs,
  activeTab,
  onTabChange,
  actions,
  width = 320,
  bodyMaxHeight = "min(384px, 52vh)",
  footer,
  children,
  className,
}: SelectorPopoverShellProps) {
  /**
   * The body ceiling with Radix's own measurement folded in.
   *
   * `--radix-popover-content-available-height` is written by the popper onto the
   * content element (children inherit it), the same variable `dataview`'s
   * settings panel uses. Radix measures it for the **whole panel**, so the tab
   * row and the pinned `footer` (`p-1` + `h-6`/`size-6` each, ≈4.125rem with
   * their borders) are subtracted before the design's `min(384px, 52vh)` is
   * applied: on a roomy viewport the result is unchanged, and on a cramped one
   * the body gives way instead of pushing the footer off the panel.
   */
  const bodyCap = `min(${bodyMaxHeight}, calc(var(--radix-popover-content-available-height, 100vh) - 4.125rem))`;

  /**
   * Opt into the enclosing dialog as the portal target (see the header note 2).
   * `null` outside a dialog — the full-screen editor — where `PopoverContent`
   * falls back to `document.body`.
   */
  const dialogContainer = useDialogContentContainer();

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        container={dialogContainer}
        side="bottom"
        align="start"
        style={{ minWidth: width, maxWidth: "calc(100vw - 2rem)" }}
        className={cn("w-auto gap-0 p-0", className)}
        onOpenAutoFocus={(event: Event) => {
          // sel §5 keyboard: `Enter` opens the panel and the caret lands in the
          // search field. Radix's focus scope would otherwise pick the first
          // tabbable node — the first tab button — so hand focus to the
          // `Command` input when the active tab has one, and leave Radix's
          // default untouched when it does not (the upload tab).
          const content = event.currentTarget as HTMLElement | null;
          const input = content?.querySelector<HTMLElement>("[cmdk-input]");
          if (!input) return;
          event.preventDefault();
          input.focus();
        }}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 p-1">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {tabs.map((tab) => {
              const active = tab.value === activeTab;
              return (
                <Button
                  key={tab.value}
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={active}
                  className={cn(
                    "h-6 min-w-0 flex-1 gap-1.5 rounded-md px-2 text-xs hover:bg-background/70",
                    active
                      ? "bg-background text-foreground shadow-xs hover:bg-background"
                      : "text-muted-foreground",
                  )}
                  onClick={() => onTabChange(tab.value)}
                >
                  <span className="truncate">{tab.label}</span>
                </Button>
              );
            })}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-1">{actions}</div>
          ) : null}
        </div>
        {/* Body ceiling — **the panel's scroll contract** (G2-r1 第 1 条).
            The old shape put the ceiling on the `Command` (inline `maxHeight`)
            and expected the host's `flex-1 min-h-0` `CommandList` to scroll
            through it. A flex item inside an `height: auto` flex container is
            *not* shrunk by that container's `max-height`: the 368-cell grid
            computed ~1900px, `Command` clipped it at 384px and no scrollport
            existed anywhere — nothing could scroll.

            Two independent mechanisms now, both copied from shapes that already
            work in this repo:
            1. **`CommandList` owns the ceiling again** — `popover + Command +
                CommandList` with the list's own `max-height: auto
                overflow-y-auto` is how `dataview/shared/field-picker.tsx` and
                `settings-panel.tsx` scroll inside this very editor dialog; M2
                had switched it off with `max-h-none`. The cap is handed over as
                a CSS variable so the shell stays the one place that knows it,
                minus the search row's height (`CommandInput`'s wrapper is
                `p-1 pb-0` + `h-8` = 2.25rem; the list is the only body child on
                every grid tab).
            2. **The wrapper is a single safety net** for hosts whose body is not
                a `CommandList` (the upload panes): same cap, `overflow-y-auto`.
                On a grid tab the two add up to exactly the cap, so the wrapper
                never grows a second scrollbar.

            The cap also folds in `--radix-popover-content-available-height`
            (which Radix sets on the popover content and children inherit, the
            same variable `settings-panel.tsx` uses), so a popover anchored near
            the viewport edge is never taller than the space Radix measured for
            it. `Command` keeps giving up clipping (`overflow-visible` — the same
            `tailwind-merge` group as its base `overflow-hidden`, so the later
            class wins) and `height: auto` stays inline because the base class is
            `size-full` and `tailwind-merge` does not treat `size-*` as
            conflicting with `h-*`. `SelectorSearchInput` pins itself to the top of
            whichever of the two viewports ends up scrolling. */}
        <div
          className="min-h-0 overflow-y-auto overscroll-contain"
          style={{ maxHeight: bodyCap }}
        >
          <Command
            shouldFilter
            className="rounded-none! overflow-visible bg-transparent p-0 [&_[cmdk-list]]:max-h-[calc(var(--media-body-cap)_-_2.25rem)]"
            style={
              { height: "auto", "--media-body-cap": bodyCap } as CSSProperties
            }
          >
            {children}
          </Command>
        </div>
        {/* Pinned rows (底色) — outside the scrollport above, so a long grid can
            never push them out of sight. */}
        {footer}
      </PopoverContent>
    </Popover>
  );
}
