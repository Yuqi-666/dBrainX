// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import "@workspace/editor/components/tiptap-ui-primitive/separator/separator.scss";
import { cn } from "@workspace/editor/lib/tiptap-utils";

export type Orientation = "horizontal" | "vertical";

export function Separator({
  decorative,
  orientation = "vertical",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  orientation?: Orientation;
  decorative?: boolean;
}) {
  const ariaOrientation = orientation === "vertical" ? orientation : undefined;
  const semanticProps = decorative
    ? { role: "none" }
    : { "aria-orientation": ariaOrientation, role: "separator" };

  return (
    <div
      className={cn("tiptap-separator", className)}
      data-orientation={orientation}
      {...semanticProps}
      {...props}
    />
  );
}
