// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";
import { isShieldedByInnerLayer } from "@workspace/ui/lib/inner-layer";
import { Button } from "@workspace/ui/components/ui/button";
import { XIcon } from "lucide-react";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  useI18n();

  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  useI18n();

  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  useI18n();

  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  useI18n();

  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  useI18n();

  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The DOM node a popover **inside this dialog** should portal into.
 *
 * Load-bearing, not a convenience (G2-r2 实测): a `modal` Radix dialog mounts
 * `react-remove-scroll` with `shards: [contentRef]`, and that library cancels —
 * `preventDefault()`, both `wheel` and `touchmove` — every event whose target
 * is **outside** every shard. A `PopoverContent` portalled to `document.body`
 * therefore cannot be scrolled *at all* while a modal dialog is open, however
 * correct its own CSS is. Portalling it into the dialog content puts it inside
 * the shard, which is also the only way `position: fixed` + the dialog's own
 * `transform` stay consistent.
 *
 * **Opt-in**: a consumer that needs this passes the value to `PopoverContent`'s
 * `container` (`SelectorPopoverShell` is the one that does today). It is not read
 * centrally in `ui/popover.tsx` because some dialogs are scroll containers
 * themselves (`max-h-[85vh] overflow-y-auto` or `overflow-hidden`),
 * where a portalled panel would be clipped rather than merely unscrollable.
 * Plan §M2.2-8 / §M2.1 第 7 行.
 */
const DialogContentContainerContext = React.createContext<HTMLElement | null>(
  null,
);

/** The nearest enclosing `DialogContent` element, or `null` outside a dialog. */
function useDialogContentContainer() {
  useI18n();

  return React.useContext(DialogContentContainerContext);
}

/** Keeps both the context ref and a caller-supplied `ref` alive. */
function composeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  const { t } = useI18n();

  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  /**
   * Whether an inner layer was shielding this content when the in-flight
   * pointerdown started — see {@link isShieldedByInnerLayer}.
   *
   * It has to be read at **capture** time, before any dismissal runs: the inner
   * layer's own outside-pointerdown handler is a `document` listener in the
   * bubble phase, and by the time the handlers below are asked, that layer has
   * already been dismissed and unshielded this content (measured: the content's
   * inline `pointer-events` is back to `auto`, but the gesture started under
   * `none`).
   */
  const shieldedAtPointerDown = React.useRef(false);
  React.useEffect(() => {
    if (!container) return;
    const snapshot = () => {
      shieldedAtPointerDown.current = isShieldedByInnerLayer(container);
    };
    document.addEventListener("pointerdown", snapshot, true);
    return () => document.removeEventListener("pointerdown", snapshot, true);
  }, [container]);
  const { ref: forwardedRef, ...contentProps } = props;
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        ref={composeRefs<HTMLDivElement>(
          setContainer,
          forwardedRef as React.Ref<HTMLDivElement> | undefined,
        )}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...contentProps}
        // A dismissal that started while an inner layer was up belongs to that
        // layer: it is how the menu/popover closes, not a request to close this
        // dialog. Both hooks are read because either one can be the one that
        // dismisses (`DismissableLayer` asks `onPointerDownOutside`, then
        // `onInteractOutside`, and only then `onDismiss` unless something
        // prevented it).
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event);
          if (shieldedAtPointerDown.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          if (shieldedAtPointerDown.current) event.preventDefault();
        }}
      >
        <DialogContentContainerContext.Provider value={container}>
          {children}
        </DialogContentContainerContext.Provider>
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-4 right-4"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">{t("Close")}</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  useI18n();

  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t("Close")}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  useI18n();

  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading leading-none font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  useI18n();

  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  useDialogContentContainer,
};
