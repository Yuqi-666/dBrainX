// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { NodeIcon } from "@workspace/interfaces";
import { Globe } from "lucide-react";
import { IconView } from "@workspace/ui/components/icon/icon-view";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The icon a workspace shows in front of its name.
 *
 * A workspace without a stored icon falls back to a globe, which is the glyph
 * the picker used before workspace icons existed. Sizing comes from the caller:
 * `className` sizes the box and `glyphClassName` the Lucide glyph inside it, the
 * same contract as `IconView`.
 */
export function WorkspaceIcon({
  icon,
  className,
  glyphClassName,
}: {
  icon?: NodeIcon | null;
  className?: string;
  glyphClassName?: string;
}) {
  return (
    <IconView
      icon={icon ?? undefined}
      className={cn("shrink-0", className)}
      glyphClassName={glyphClassName}
      fallback={<Globe className={cn("shrink-0", className)} />}
    />
  );
}
