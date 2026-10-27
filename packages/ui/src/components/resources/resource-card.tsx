// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { ResourceRecord } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/ui/badge";
import { Button } from "@workspace/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { toast } from "@workspace/ui/components/ui/toast";
import {
  LinkIcon,
  MoreVerticalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { CategoryIcon, categoryLabel } from "./resource-category";
import { formatBytes, formatCreatedAt } from "./format-bytes";

export interface ResourceCardProps {
  resource: ResourceRecord;
  onRename: (resource: ResourceRecord) => void;
  onDelete: (resource: ResourceRecord) => void;
}

/**
 * One resource in the grid.
 *
 * Only images get a real preview. Video, audio and PDF cards show the category
 * icon instead of a media element: a grid of paused `<video>` elements would
 * download every file just to paint a poster frame, and the file itself is one
 * click away in the node that references it.
 */
export function ResourceCard({
  resource,
  onRename,
  onDelete,
}: ResourceCardProps) {
  const { t, locale } = useI18n();

  const name = resource.name || t("未命名文件");
  const titleId = `resource-title-${resource.id}`;
  const hasImagePreview = resource.category === "image" && !!resource.url;

  const copyLink = async () => {
    try {
      // `storedUrl` is the address written into node content; `url` is only the
      // resolved form the page can load.
      await navigator.clipboard.writeText(resource.storedUrl);
      toast({ title: t("链接已复制") });
    } catch {
      toast({
        title: t("复制失败，请手动复制链接。"),
        variant: "destructive",
      });
    }
  };

  return (
    <article
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {hasImagePreview ? (
          <img
            src={resource.url}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <CategoryIcon
            category={resource.category}
            className="absolute inset-0 m-auto size-10 text-muted-foreground/70"
          />
        )}
        <Badge
          variant="secondary"
          className="absolute top-2 left-2 bg-background/85 backdrop-blur-sm"
        >
          {categoryLabel(resource.category, t)}
        </Badge>
      </div>

      <div className="flex min-w-0 items-start gap-1 p-3">
        <div className="min-w-0 flex-1">
          <h3
            id={titleId}
            title={name}
            className="truncate text-sm font-medium"
          >
            {name}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {formatBytes(resource.fileSize)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t("创建于 {value1}", {
                value1: formatCreatedAt(resource.createdAt, locale),
              })}
            </span>
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("打开 {value1} 的操作菜单", { value1: name })}
            >
              <MoreVerticalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={() => onRename(resource)}>
              <PencilIcon />
              {t("重命名")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyLink()}>
              <LinkIcon />
              {t("复制链接")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(resource)}
            >
              <Trash2Icon />
              {t("删除")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
