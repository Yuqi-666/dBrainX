// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

/**
 * Shared empty state for data views: no rows, missing required fields, or a
 * renderer that is still a placeholder.
 *
 * It is an invitation, not a mood: the title says what is missing in the
 * interface's voice, the description says what to do about it, and `children`
 * carries the action.
 */
export function DataViewEmptyState({
  icon: Icon,
  title,
  description,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center",
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
        <Icon className="size-5 text-muted-foreground" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
