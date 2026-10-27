// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { ReactNode } from "react";
import { CommandInput } from "@workspace/ui/components/ui/command";
import { cn } from "@workspace/ui/lib/utils";

export interface SelectorSearchInputProps {
  /** Defaults to the design's `Click to filter…`. */
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SelectorSearchInput({
  placeholder = "Click to filter…",
  autoFocus,
  disabled,
  className,
}: SelectorSearchInputProps): ReactNode {
  return (
    // The shell caps the body and lets either the body wrapper or the
    // `CommandList` below it do the scrolling, so this row pins itself to the top
    // of whichever viewport ends up scrolling: a 46-row emoji grid must not take
    // the filter box away. `z-10` is load-bearing — `CommandItem` is itself
    // `relative`, and a positioned sibling later in DOM order paints above a
    // `z-index: auto` sticky row. `bg-popover` is opaque, so the cells scroll
    // *behind* the row instead of showing through the input group's
    // translucent fill.
    <div className="sticky top-0 z-10 bg-popover">
      <CommandInput
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={cn(className)}
      />
    </div>
  );
}
