// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import { Toast as ToastPrimitive } from "radix-ui";

import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

function ToastProvider({
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Provider>) {
  useI18n();

  return <ToastPrimitive.Provider data-slot="toast-provider" {...props} />;
}

function ToastViewport({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  useI18n();

  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
        className,
      )}
      {...props}
    />
  );
}

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-lg border p-4 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive: "border-destructive bg-destructive text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function ToastRoot({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> &
  VariantProps<typeof toastVariants>) {
  useI18n();

  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
}

function ToastTitle({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Title>) {
  useI18n();

  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
  useI18n();

  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function ToastClose({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Close>) {
  const { t } = useI18n();

  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      className={cn(
        "absolute top-2 right-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground",
        className,
      )}
      {...props}
    >
      <XIcon className="size-4" />
      <span className="sr-only">{t("Close")}</span>
    </ToastPrimitive.Close>
  );
}

/** What a caller may pass to {@link toast}. */
export interface ToastOptions {
  /** Short, already-translated heading. */
  title?: React.ReactNode;
  /** Optional second line, for example the uploaded file name. */
  description?: React.ReactNode;
  /** Visual tone; `destructive` matches the button variant of the same name. */
  variant?: "default" | "destructive";
  /** Auto-dismiss delay in milliseconds. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
  open: boolean;
}

const DEFAULT_TOAST_DURATION = 5000;
/** Time the exit animation gets before the record is dropped. */
const TOAST_REMOVE_DELAY = 200;
const EMPTY_TOASTS: ToastRecord[] = [];

let toastRecords: ToastRecord[] = EMPTY_TOASTS;
const toastListeners = new Set<() => void>();

function subscribeToToasts(listener: () => void): () => void {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}

function getToastSnapshot(): ToastRecord[] {
  return toastRecords;
}

function getServerToastSnapshot(): ToastRecord[] {
  return EMPTY_TOASTS;
}

function emitToastChange(): void {
  toastListeners.forEach((listener) => listener());
}

/**
 * Shows a toast.
 *
 * The queue is module-level, so an upload may fire a toast from the closure of
 * a component that has already unmounted (the node editor dialog was closed
 * before the upload finished).
 */
export function toast(options: ToastOptions) {
  const id = crypto.randomUUID();
  const record: ToastRecord = {
    id,
    open: true,
    duration: DEFAULT_TOAST_DURATION,
    variant: "default",
    ...options,
  };

  // Keep the stack short: a burst of uploads must not cover the app.
  toastRecords = [record, ...toastRecords].slice(0, 3);
  emitToastChange();

  return { id, dismiss: () => dismissToast(id) };
}

/** Starts a toast's exit animation, then removes it from the queue. */
export function dismissToast(id: string): void {
  const record = toastRecords.find((item) => item.id === id);
  if (!record || !record.open) return;

  toastRecords = toastRecords.map((item) =>
    item.id === id ? { ...item, open: false } : item,
  );
  emitToastChange();

  window.setTimeout(() => {
    toastRecords = toastRecords.filter((item) => item.id !== id);
    emitToastChange();
  }, TOAST_REMOVE_DELAY);
}

/**
 * Renders the toast queue. Mount it once per app, under the shell that stays
 * mounted while a node dialog opens and closes.
 */
export function Toaster() {
  useI18n();

  const toasts = React.useSyncExternalStore(
    subscribeToToasts,
    getToastSnapshot,
    getServerToastSnapshot,
  );

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, variant, duration, open }) => (
        <ToastRoot
          key={id}
          open={open}
          duration={duration}
          variant={variant}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) dismissToast(id);
          }}
        >
          <div className="grid gap-1">
            {title ? <ToastTitle>{title}</ToastTitle> : null}
            {description ? (
              <ToastDescription>{description}</ToastDescription>
            ) : null}
          </div>
          <ToastClose />
        </ToastRoot>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}

export {
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  toastVariants,
};
