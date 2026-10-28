// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

/**
 * Shared empty-state block for node content editors: an icon, what is missing,
 * and optionally how to fill it in.
 */
export function EmptyHint({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
        className,
      )}
    >
      <Icon className="size-10 text-muted-foreground/70" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground/70">
          {description}
        </p>
      )}
    </div>
  );
}
