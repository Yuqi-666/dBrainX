// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { cn } from "@workspace/editor/lib/tiptap-utils";
import "@workspace/editor/components/tiptap-ui-primitive/input/input.scss";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="tiptap-input"
      className={cn("tiptap-input", className)}
      {...props}
    />
  );
}

export { Input };
