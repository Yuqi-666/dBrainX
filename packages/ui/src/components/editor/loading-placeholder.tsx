// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Skeleton } from "@workspace/ui/components/ui/skeleton";

interface LoadingPlaceholderProps {
  /** 显示类型，决定骨架屏的形状和比例 */
  variant?: "image" | "audio" | "video" | "pdf" | "card";
  className?: string;
}

function LoadingPlaceholder({
  variant = "card",
  className,
}: LoadingPlaceholderProps) {
  switch (variant) {
    case "image":
      return (
        <div
          className={cn(
            "relative  aspect-[16/9] rounded-lg overflow-hidden",
            className,
          )}
        >
          <Skeleton className="size-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Skeleton className="size-12 rounded-full" />
          </div>
        </div>
      );

    case "audio":
      return (
        <div className={cn("flex items-center gap-4 w-full p-4", className)}>
          <Skeleton className="size-12 rounded-full" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
        </div>
      );

    case "video":
      return (
        <Skeleton className={cn("w-full aspect-video rounded-lg", className)} />
      );

    case "pdf":
      return (
        <Skeleton
          className={cn("w-full aspect-[1/√2] rounded-lg", className)}
        />
      );

    case "card":
    default:
      return (
        <div className={cn("flex flex-col gap-3 w-full p-4", className)}>
          <Skeleton className="h-5 w-2/3 rounded" />
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-5/6 rounded" />
          <Skeleton className="h-4 w-4/5 rounded" />
        </div>
      );
  }
}

export { LoadingPlaceholder };
