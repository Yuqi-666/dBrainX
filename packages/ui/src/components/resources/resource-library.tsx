// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useMemo, useRef, useState } from "react";
import {
  STORAGE_CATEGORIES,
  storageUsageOf,
  useResources,
  useStorageLimits,
  type ResourceRecord,
  type StorageCategory,
} from "@workspace/api-client";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/ui/alert";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/ui/empty";
import { Skeleton } from "@workspace/ui/components/ui/skeleton";
import { Progress } from "@workspace/ui/components/ui/progress";
import { cn } from "@workspace/ui/lib/utils";
import {
  AlertTriangleIcon,
  InfoIcon,
  LibraryIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react";
import { StorageUsagePanel } from "./storage-usage-panel";
import { ResourceCard } from "./resource-card";
import {
  ResourceToolbar,
  type ResourceCategoryFilter,
} from "./resource-toolbar";
import { useResourceUpload } from "./use-resource-upload";
import { RenameResourceDialog } from "./rename-resource-dialog";
import { DeleteResourceDialog } from "./delete-resource-dialog";

/**
 * The `/resources` surface: the media resource library.
 *
 * The shell keeps this component mounted after the first visit (see
 * `apps/web/components/workspace-shell.tsx`), so it reads the collection only
 * when the page loads or after a mutation, not on every surface switch. The
 * list is scoped to `mine` because that is the set the per-user quota charges;
 * nodes may still reference a teammate's file through the selector.
 */
export function ResourceLibrary() {
  const { t } = useI18n();

  // Derived artifacts (a PDF cover, an HLS playlist and its segments) are
  // fetched so the storage panel can charge their bytes, but they are not files
  // the user chose, so `listedResources` below hides them from every card,
  // count and search.
  const { resources, loading, error, reload } = useResources({
    scope: "mine",
    includeDerived: true,
  });
  const limits = useStorageLimits();
  // The quota charges every record, derived artifacts included.
  const usage = useMemo(() => storageUsageOf(resources), [resources]);
  // What the library shows: everything the server did not derive from a file.
  const listedResources = useMemo(
    () => resources.filter((resource) => !resource.derived),
    [resources],
  );

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ResourceCategoryFilter>("all");
  const [renameTarget, setRenameTarget] = useState<ResourceRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResourceRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploading, progress, uploadFiles } = useResourceUpload({
    limits,
    usedBytes: usage.total,
    onUploaded: reload,
  });

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      listedResources.filter(
        (resource) =>
          (category === "all" || resource.category === category) &&
          (normalizedQuery === "" ||
            resource.name.toLowerCase().includes(normalizedQuery)),
      ),
    [listedResources, category, normalizedQuery],
  );

  const counts = useMemo(() => {
    const next: Record<StorageCategory, number> = {
      image: 0,
      video: 0,
      audio: 0,
      pdf: 0,
      webpage: 0,
      other: 0,
    };
    for (const resource of listedResources) next[resource.category] += 1;
    return next;
  }, [listedResources]);

  const openPicker = () => fileInputRef.current?.click();
  const firstLoad = loading && listedResources.length === 0 && !error;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/*
        No `accept` filter on purpose: the library accounts for all six
        categories, including the `other` catch-all that only exists for files
        outside the media and PDF families. Narrowing the picker would make that
        category impossible to fill; `checkResourceLimit` gates each file.
      */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onChange={(event) => {
          // Copy first and clear the input so picking the same file again still
          // fires a change event.
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length > 0) uploadFiles(files);
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto w-full max-w-6xl px-4 py-6 lg:px-8",
            // The dynamic island floats over the top centre of the surface.
            "pt-16",
          )}
        >
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("Resource library")}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {t(
                  "上传的图片、音视频和文档都在这里；可以重命名、复制链接，也可以释放存储空间。",
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                disabled={loading}
                aria-label={t("刷新")}
                onClick={reload}
              >
                <RefreshCwIcon
                  className={cn(
                    "size-4",
                    loading && "animate-spin motion-reduce:animate-none",
                  )}
                />
                <span className="hidden sm:inline">{t("刷新")}</span>
              </Button>
              <Button disabled={uploading} onClick={openPicker}>
                {uploading ? (
                  <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <UploadIcon className="size-4" />
                )}
                {uploading ? t("上传中…") : t("上传文件")}
              </Button>
            </div>
          </header>

          {progress ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-4 rounded-lg border bg-muted/30 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {t("正在上传 {value1}/{value2}", {
                    value1: progress.current,
                    value2: progress.total,
                  })}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {progress.percent}%
                </span>
              </div>
              <div aria-hidden="true">
                <Progress
                  className="mt-2 h-1.5"
                  value={
                    ((progress.current - 1 + progress.percent / 100) /
                      progress.total) *
                    100
                  }
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive" className="mt-6">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>{t("资源加载失败")}</AlertTitle>
              <AlertDescription>
                <div className="flex flex-wrap items-center gap-3">
                  <span>{t("加载资源时出错，请检查网络后重试。")}</span>
                  <Button variant="outline" size="sm" onClick={reload}>
                    {t("重试")}
                  </Button>
                </div>
                <p className="mt-2 text-xs opacity-80">{error}</p>
              </AlertDescription>
            </Alert>
          ) : firstLoad ? (
            <>
              <p className="sr-only" role="status">
                {t("正在加载资源…")}
              </p>
              <ResourceLibrarySkeleton />
            </>
          ) : listedResources.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed bg-background/60">
              <Empty className="min-h-80">
                <div className="flex size-14 items-center justify-center rounded-2xl border bg-background">
                  <LibraryIcon className="size-6 text-muted-foreground" />
                </div>
                <EmptyHeader>
                  <EmptyTitle className="text-base">
                    {t("还没有任何资源")}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t(
                      "上传图片、音视频或文档，它们会出现在这里，也能在节点中引用。",
                    )}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button disabled={uploading} onClick={openPicker}>
                    <UploadIcon className="size-4" />
                    {t("上传第一个文件")}
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : (
            <>
              <StorageUsagePanel usage={usage} limits={limits} />
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                {t(
                  "删除节点不会删除它引用的文件；只有在这里删除，存储空间才会释放。",
                )}
              </p>

              <ResourceToolbar
                query={query}
                onQueryChange={setQuery}
                category={category}
                onCategoryChange={setCategory}
                counts={counts}
                totalCount={listedResources.length}
                visibleCount={filtered.length}
              />

              {filtered.length === 0 ? (
                <Empty className="mt-4 rounded-xl border border-dashed bg-muted/20 py-12">
                  <EmptyHeader>
                    <EmptyTitle>{t("没有符合条件的资源")}</EmptyTitle>
                    <EmptyDescription>
                      {t("换个关键词或类型试试。")}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        setCategory("all");
                      }}
                    >
                      {t("清除筛选")}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filtered.map((resource) => (
                    <ResourceCard
                      key={resource.id}
                      resource={resource}
                      onRename={setRenameTarget}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <RenameResourceDialog
        resource={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={reload}
      />
      <DeleteResourceDialog
        resource={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={reload}
      />
    </div>
  );
}

/** First-load placeholder: the storage panel and the grid, in skeleton form. */
function ResourceLibrarySkeleton() {
  return (
    <div aria-hidden="true" className="mt-6 space-y-6">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-baseline justify-between gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
        {/* The segmented storage bar and its six-item legend. */}
        <Skeleton className="mt-4 h-4 w-full rounded-full" />
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {Array.from({ length: STORAGE_CATEGORIES.length }, (_, index) => (
            <Skeleton key={index} className="h-3 w-16" />
          ))}
        </div>
      </div>
      <Skeleton className="h-9 w-full max-w-xs" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="aspect-video w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
