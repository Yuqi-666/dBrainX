// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useState } from "react";
import {
  FileCode2Icon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  currentResourceOwnerId,
  useResources,
} from "@workspace/api-client";
import type { ResourceRecord } from "@workspace/api-client";
import {
  STORAGE_CATEGORIES,
  storageCategoryFor,
} from "@workspace/utils/storage-limits";
import type { StorageCategory } from "@workspace/utils/storage-limits";
import { Badge } from "@workspace/ui/components/ui/badge";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import { Input } from "@workspace/ui/components/ui/input";
import { Skeleton } from "@workspace/ui/components/ui/skeleton";
import { cn } from "@workspace/ui/lib/utils";

/** Lucide icon drawn where an image thumbnail cannot be shown. */
const CATEGORY_ICONS: Record<StorageCategory, LucideIcon> = {
  image: ImageIcon,
  video: VideoIcon,
  audio: MusicIcon,
  pdf: FileTextIcon,
  webpage: FileCode2Icon,
  other: FileIcon,
};

/** Source copy of each category tab; translated through `t()` at render time. */
const CATEGORY_LABELS: Record<StorageCategory, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  pdf: "PDF",
  webpage: "网页",
  other: "其他",
};

/** One mebibyte, the unit sizes below the label are rendered in. */
const MIB = 1024;

/** Binary unit labels, largest last. */
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * A file size in the binary units the library management page uses.
 *
 * Local on purpose: the shared `@workspace/utils` package has no formatter, and a
 * selector card only needs the plain "12.3 MB" label, not locale-aware digits.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${BYTE_UNITS[0]}`;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(MIB)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / MIB ** exponent;
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[exponent] ?? BYTE_UNITS[0]}`;
}

/**
 * The resource categories an `<input accept>`-shaped string allows.
 *
 * The node hosts state an accept list (`.pdf,application/pdf`, `image/*`,
 * `audio/*`, …), and the selector must not offer a video for an audio field.
 * Extensions and concrete MIME types are classified with the same
 * `storageCategoryFor` the upload path and the PocketBase hook use, so the
 * selector cannot disagree with the node type that opened it.
 *
 * An empty or wholly wildcard list allows every category.
 */
function categoriesForAccept(accept?: string): StorageCategory[] {
  const patterns = (accept ?? "")
    .split(",")
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);

  if (patterns.length === 0) return [...STORAGE_CATEGORIES];

  const allowed = new Set<StorageCategory>();
  for (const pattern of patterns) {
    if (pattern === "*" || pattern === "*/*") return [...STORAGE_CATEGORIES];

    if (pattern.startsWith(".")) {
      allowed.add(storageCategoryFor(`file${pattern}`));
      continue;
    }

    if (pattern.endsWith("/*")) {
      const family = pattern.slice(0, -2);
      if (family === "image" || family === "video" || family === "audio") {
        allowed.add(family);
        continue;
      }
    }

    // A concrete MIME type (`application/pdf`, `text/html`, …) or an unknown
    // family: the classifier's MIME half gives the category.
    allowed.add(storageCategoryFor("file", pattern));
  }

  return STORAGE_CATEGORIES.filter((category) => allowed.has(category));
}

/** Small preview of one resource: the picture itself, or its category icon. */
function ResourceThumbnail({ resource }: { resource: ResourceRecord }) {
  if (resource.category === "image" && resource.url) {
    return (
      <img
        src={resource.url}
        loading="lazy"
        alt=""
        draggable={false}
        className="size-full object-cover"
      />
    );
  }

  const CategoryIcon = CATEGORY_ICONS[resource.category];
  return <CategoryIcon className="size-8 text-muted-foreground" />;
}

export interface ResourceSelectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The node host's accept list. It both filters the list and decides which
   * category tabs appear; omit it to see the whole library.
   */
  accept?: string;
  onSelect: (resource: ResourceRecord) => void;
  /** Dialog heading; defaults to 「从资源库选择」. */
  title?: string;
}

/**
 * Picks one already-uploaded blob and hands it to the host.
 *
 * The library is read-only here: this dialog never uploads, renames or deletes,
 * and it reads with the `visible` scope so a workspace member can reference a
 * teammate's upload without owning it. The host receives the record and decides
 * which node fields to write (a media variant stores `content.url`, a cover
 * stores the top-level `cover`, …).
 *
 * Reached from the 「从资源库选择」 method card in the media drop zones.
 */
export function ResourceSelectorDialog({
  open,
  onOpenChange,
  accept,
  onSelect,
  title,
}: ResourceSelectorDialogProps) {
  const { t } = useI18n();

  // The PocketBase owner id, not the graph user id: they differ in the desktop
  // local mode, where the graph user is a fixed local identity.
  const currentUserId = currentResourceOwnerId();

  // `enabled` keeps the list from loading for every mounted but closed dialog
  // (a node can mount several drop zones at once).
  const { resources, loading, error, reload } = useResources({
    scope: "visible",
    enabled: open,
  });

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<StorageCategory | "all">(
    "all",
  );

  // Every open starts from the unfiltered library: a category picked for one
  // node must not hide the resources of the next node the dialog serves.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveCategory("all");
  }, [open]);

  const allowedCategories = categoriesForAccept(accept);
  // With one allowed category there is nothing to filter; the tab row would
  // only take space away from the grid.
  const showCategoryTabs = allowedCategories.length > 1;

  const needle = query.trim().toLowerCase();
  const visibleResources = resources.filter((resource) => {
    if (!allowedCategories.includes(resource.category)) return false;
    if (activeCategory !== "all" && resource.category !== activeCategory) {
      return false;
    }
    return !needle || resource.name.toLowerCase().includes(needle);
  });

  const selectResource = (resource: ResourceRecord) => {
    onSelect(resource);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title ?? t("从资源库选择")}</DialogTitle>
          <DialogDescription>
            {t("选择已上传的资源，节点会引用该文件。")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索资源名称…")}
            aria-label={t("搜索资源名称…")}
          />

          {showCategoryTabs && (
            <div
              role="group"
              aria-label={t("按分类筛选")}
              className="flex flex-wrap gap-1"
            >
              {[
                { value: "all" as const, label: t("全部") },
                ...allowedCategories.map((category) => ({
                  value: category,
                  label: t(CATEGORY_LABELS[category]),
                })),
              ].map((tab) => {
                const active = activeCategory === tab.value;
                return (
                  <Button
                    key={tab.value}
                    type="button"
                    size="sm"
                    variant={active ? "secondary" : "ghost"}
                    aria-pressed={active}
                    className={cn(
                      "h-7 rounded-md px-2 text-xs",
                      active ? "" : "text-muted-foreground",
                    )}
                    onClick={() => setActiveCategory(tab.value)}
                  >
                    {tab.label}
                  </Button>
                );
              })}
            </div>
          )}

          <div className="max-h-[min(60vh,30rem)] min-h-[10rem] overflow-y-auto pr-1">
            {loading ? (
              <div aria-busy="true">
                <span className="sr-only">{t("正在加载资源…")}</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div
                      key={index}
                      className="flex flex-col overflow-hidden rounded-lg border border-border/60"
                    >
                      <Skeleton className="aspect-video w-full rounded-none" />
                      <div className="space-y-1 p-2">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-2.5 w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : error ? (
              <div
                role="alert"
                className="flex flex-col items-center gap-2 py-10 text-center"
              >
                <p className="text-sm text-destructive">
                  {t("资源库加载失败")}
                </p>
                <p className="text-xs break-words text-muted-foreground">
                  {error}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={reload}
                >
                  {t("重试")}
                </Button>
              </div>
            ) : visibleResources.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {resources.length === 0
                    ? t("资源库还是空的")
                    : t("没有匹配的资源")}
                </p>
                {resources.length === 0 && (
                  <p className="text-xs text-muted-foreground/70">
                    {t("先上传文件，之后就能在这里直接引用。")}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visibleResources.map((resource) => {
                  const isShared =
                    Boolean(currentUserId) &&
                    Boolean(resource.ownerId) &&
                    resource.ownerId !== currentUserId;

                  return (
                    <button
                      key={resource.id}
                      type="button"
                      onClick={() => selectResource(resource)}
                      className={cn(
                        "group flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card text-left transition-colors",
                        "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      )}
                    >
                      <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-muted">
                        <ResourceThumbnail resource={resource} />
                      </div>
                      <div className="flex w-full flex-col gap-0.5 p-2">
                        <span
                          className="truncate text-xs font-medium"
                          title={resource.name}
                        >
                          {resource.name}
                        </span>
                        <span className="flex items-center justify-between gap-1">
                          <span className="text-[11px] text-muted-foreground">
                            {formatBytes(resource.fileSize)}
                          </span>
                          {isShared && (
                            <Badge
                              variant="muted"
                              className="px-1 py-0 text-[10px]"
                            >
                              {t("共享")}
                            </Badge>
                          )}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
