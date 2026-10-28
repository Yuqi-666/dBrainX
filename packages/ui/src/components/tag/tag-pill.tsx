// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { NodeTag, NodeTagId } from "@workspace/interfaces";
import { Trash2 } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

export function TagPill({
  tag,
  tagId,
  onRemove,
}: {
  tag?: NodeTag;
  tagId: NodeTagId;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs",
        "bg-muted/80 hover:bg-muted transition-all",
        "ring-1 ring-transparent hover:ring-destructive/20 cursor-default",
      )}
    >
      {tag?.color && (
        <div
          className="w-2.5 h-2.5 rounded-full ring-1 ring-white/20"
          style={{ backgroundColor: tag.color }}
        />
      )}
      <span className="font-medium">{tag?.name || tagId}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={cn(
          "ml-0.5 rounded-full p-0.5",
          "opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive",
          "transition-all",
        )}
        aria-label={`Remove ${tag?.name || tagId}`}
      >
        <Trash2 className="size-3" />
      </button>
    </span>
  );
}
