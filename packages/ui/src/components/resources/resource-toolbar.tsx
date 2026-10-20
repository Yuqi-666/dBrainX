// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { STORAGE_CATEGORIES } from "@workspace/api-client";
import type { StorageCategory } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import { cn } from "@workspace/ui/lib/utils";
import { SearchIcon } from "lucide-react";
import { CATEGORY_LABEL_KEYS } from "./resource-category";

/** `all` is the unfiltered toolbar state; the rest are storage categories. */
export type ResourceCategoryFilter = StorageCategory | "all";

const FILTERS: readonly ResourceCategoryFilter[] = [
  "all",
  ...STORAGE_CATEGORIES,
];

export interface ResourceToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  category: ResourceCategoryFilter;
  onCategoryChange: (category: ResourceCategoryFilter) => void;
  counts: Record<StorageCategory, number>;
  totalCount: number;
  visibleCount: number;
}

/** Search, category filters and the result count above the resource grid. */
export function ResourceToolbar({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  counts,
  totalCount,
  visibleCount,
}: ResourceToolbarProps) {
  const { t } = useI18n();

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full min-w-0 sm:max-w-xs">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            aria-label={t("搜索资源")}
            placeholder={t("搜索资源…")}
            className="pl-8"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <span className="text-sm text-muted-foreground tabular-nums sm:ml-auto">
          {t("共 {value1} 个资源", { value1: visibleCount })}
        </span>
      </div>

      <div
        role="group"
        aria-label={t("按类型筛选")}
        className="flex flex-wrap items-center gap-1.5"
      >
        {FILTERS.map((value) => {
          const active = value === category;
          const count = value === "all" ? totalCount : counts[value];
          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={active ? "secondary" : "ghost"}
              aria-pressed={active}
              className="gap-1.5"
              onClick={() => onCategoryChange(value)}
            >
              {value === "all" ? t("全部") : t(CATEGORY_LABEL_KEYS[value])}
              <span
                className={cn(
                  "rounded-sm px-1 text-[11px] tabular-nums",
                  active
                    ? "bg-background/70 text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {count}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
