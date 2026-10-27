// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  container,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /**
   * Portal target; default `document.body` (Radix's own default).
   *
   * **Opt-in on purpose.** A consumer rendered inside a `DialogContent` should
   * pass that element (see `dialog.tsx`'s `useDialogContentContainer`), because a
   * `modal` Radix dialog installs `react-remove-scroll` with
   * `shards: [contentRef]` and that library `preventDefault()`s every `wheel` /
   * `touchmove` whose target is outside every shard — a panel portalled to
   * `document.body` inside a modal dialog therefore cannot be scrolled at all,
   * whatever its own overflow says (G2-r2 实测; plan §M2.2-8). `SelectorPopoverShell`
   * is the consumer that opts in today. It stays opt-in instead of being read
   * from the dialog context here because some dialogs **are** scroll containers
   * (`max-h-[85vh] overflow-y-auto` on the filter / view dialogs,
   * or `overflow-hidden`): a panel portalled inside those would be
   * clipped rather than merely unscrollable.
   */
  container?: HTMLElement | null;
}) {
  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-4 rounded-md bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  );
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
};
