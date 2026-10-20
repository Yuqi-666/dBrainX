// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import * as React from "react";
import { cn } from "@workspace/editor/lib/tiptap-utils";

import "./label.scss";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="tiptap-label"
      className={cn("tiptap-label", className)}
      {...props}
    />
  );
}

export { Label };
