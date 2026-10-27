// SPDX-License-Identifier: AGPL-3.0-only

import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

/**
 * A keyboard key cap — the shadcn `kbd` primitive.
 *
 * It is styled for **two** backgrounds on purpose: standing on the page it is a
 * muted chip, while inside a tooltip it inverts (`tooltip.tsx` carries the
 * matching `has-data-[slot=kbd]` / `**:data-[slot=kbd]` rules), which is what
 * lets a hint sit at the end of a tooltip line without a second component.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none",
        "in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
