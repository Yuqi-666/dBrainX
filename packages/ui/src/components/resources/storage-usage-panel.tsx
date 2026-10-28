// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { STORAGE_CATEGORIES } from "@workspace/api-client";
import type { StorageLimits, StorageUsage } from "@workspace/api-client";
import { cn } from "@workspace/ui/lib/utils";
import {
  CATEGORY_COLOR_CLASSES,
  CategoryDot,
  categoryLabel,
} from "./resource-category";
import { formatBytes } from "./format-bytes";

/** Percentage of the quota past which the storage bar warns in destructive. */
const CRITICAL_PERCENT = 90;

/**
 * The narrowest a painted segment can get.
 *
 * A category that holds bytes but less than one percent of the bar would
 * otherwise round to an invisible sliver. `overflow-hidden` on the track keeps
 * the minimum from pushing the segments past the bar.
 */
const MIN_SEGMENT_WIDTH = "3px";

/**
 * The storage panel, laid out like the iOS storage screen: a title row with the
 * total on the right, one segmented bar (a color per category, the gray track
 * for what is left), and a legend that names each category with its bytes.
 *
 * The usage also counts the artifacts the server derived from a resource
 * (covers, HLS playlists, segments): the library hides their cards, but their
 * bytes are charged against the quota, so they must paint a segment too.
 *
 * A record without a recorded size still counts as a resource but adds no
 * bytes, so `usage.total` can understate the number of records on screen; that
 * is deliberate, because the quota is charged on bytes the server recorded.
 */
export function StorageUsagePanel({
  usage,
  limits,
}: {
  usage: StorageUsage;
  limits: StorageLimits;
}) {
  const { t } = useI18n();

  const quota = limits.userQuotaBytes;
  const unlimited = quota <= 0;
  const percent = unlimited ? 0 : (usage.total / quota) * 100;
  const critical = !unlimited && percent > CRITICAL_PERCENT;
  const usedLabel = formatBytes(usage.total);
  const quotaLabel = unlimited ? t("不限") : formatBytes(quota);
  const remainingLabel = unlimited
    ? t("不限")
    : formatBytes(Math.max(0, quota - usage.total));
  const clampedPercent = Math.min(100, Math.max(0, percent));

  // The bar is scaled to whichever is larger: the quota, so the free remainder
  // is visible, or the usage, so an over-quota occupation still fits the bar
  // instead of being clipped to its left edge.
  const barBytes = unlimited
    ? Math.max(usage.total, 1)
    : Math.max(quota, usage.total);
  const summaryLabel = t("已用 {value1} / {value2}", {
    value1: usedLabel,
    value2: quotaLabel,
  });

  return (
    <section
      aria-labelledby="resource-storage-title"
      className="mt-6 rounded-xl border bg-card p-5 text-card-foreground shadow-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="resource-storage-title"
          className="text-sm font-medium tracking-tight"
        >
          {t("存储空间")}
        </h2>
        <div className="text-right">
          <p
            className={cn(
              "text-sm font-medium tabular-nums",
              critical && "text-destructive",
            )}
          >
            {summaryLabel}
          </p>
          {unlimited ? null : (
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {t("剩余 {value1}", { value1: remainingLabel })}
            </p>
          )}
        </div>
      </div>

      {/*
        One track for the whole occupation: the painted segments are the
        categories and the gray track that shows through is the free remainder.
        Empty categories paint nothing, so they cannot claim a pixel. The
        `progressbar` role exposes the used share of the quota; an unlimited
        quota has no share to expose, so the bar degrades to an image whose
        label is the used total.
      */}
      <div
        role={unlimited ? "img" : "progressbar"}
        aria-label={
          unlimited ? `${t("存储空间占用")} ${summaryLabel}` : t("存储空间占用")
        }
        aria-valuemin={unlimited ? undefined : 0}
        aria-valuemax={unlimited ? undefined : 100}
        aria-valuenow={unlimited ? undefined : Math.round(clampedPercent)}
        className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-muted"
      >
        {STORAGE_CATEGORIES.map((category) => {
          const bytes = usage.byCategory[category];
          if (bytes <= 0) return null;
          return (
            <span
              key={category}
              aria-hidden="true"
              className={cn(
                "h-full shrink-0",
                CATEGORY_COLOR_CLASSES[category],
              )}
              style={{
                width: `${(bytes / barBytes) * 100}%`,
                minWidth: MIN_SEGMENT_WIDTH,
              }}
            />
          );
        })}
      </div>

      {critical ? (
        <p className="mt-2 text-xs text-destructive" role="status">
          {t("存储空间已用超过 90%。")}
        </p>
      ) : null}

      <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        {STORAGE_CATEGORIES.map((category) => (
          <li key={category} className="flex min-w-0 items-center gap-1.5">
            <CategoryDot category={category} />
            <span className="truncate">{categoryLabel(category, t)}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatBytes(usage.byCategory[category])}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
