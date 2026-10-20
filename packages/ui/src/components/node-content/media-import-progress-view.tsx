// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { Button } from "@workspace/ui/components/ui/button";
import { Progress } from "@workspace/ui/components/ui/progress";
import { cn } from "@workspace/ui/lib/utils";
import type {
  MediaImportProgress,
  MediaImportStage,
  MediaKind,
} from "@workspace/interfaces";

/** Host name of the pasted page, shown while the import runs. */
export function mediaImportHostLabel(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** `1536` → `1.5 KB`, `2300000` → `2.2 MB` — for the speed line only. */
function formatByteRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytesPerSecond;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

/** `95` → `1:35` — the remaining time as a clock, not as "95 seconds". */
function formatEtaSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Human label of one import phase; the download phase names the kind. */
export function mediaImportStageText(
  stage: MediaImportStage,
  kind: MediaKind,
  t: (key: string) => string,
): string {
  switch (stage) {
    case "downloading":
      return kind === "video" ? t("正在下载视频…") : t("正在下载音频…");
    case "storing":
      return t("正在保存到资源库…");
    case "packaging":
      return t("正在转码为 HLS…");
    case "preparing":
      return t("正在准备导入…");
  }
}

interface MediaImportProgressViewProps {
  /** What is being imported; names the download phase. */
  kind: MediaKind;
  /** Page address being imported; only its host name is shown. */
  url: string;
  /** Latest progress, `null` before the first update. */
  progress: MediaImportProgress | null;
  /**
   * True when the job was found interrupted after a reload: the download can
   * continue with the same job id instead of starting over.
   */
  resumable?: boolean;
  /** Continues an interrupted job; required when `resumable` is set. */
  onResume?: () => void;
  /** Cancels the import on the server (kills the download and deletes the job). */
  onCancel: () => void;
  className?: string;
}

/**
 * What the media drop zone shows while a pasted page URL is imported.
 *
 * The backend spends minutes on the job, so this replaces the method cards until
 * the node is written. The bar and the phase come from the server; the speed and
 * the remaining time are shown only when the site reports them (`0` means
 * unknown), which keeps the line from claiming a rate for a live stream.
 *
 * An interrupted job gets its own state: no progress bar to fake, the 「继续」
 * action instead, and the same cancel action that deletes the partial download.
 */
export function MediaImportProgressView({
  kind,
  url,
  progress,
  resumable = false,
  onResume,
  onCancel,
  className,
}: MediaImportProgressViewProps) {
  const { t } = useI18n();

  const percent = progress?.percent ?? 0;
  const stageLabel = progress
    ? mediaImportStageText(progress.stage, kind, t)
    : "";
  const speed =
    progress && progress.speedBytesPerSecond > 0
      ? formatByteRate(progress.speedBytesPerSecond)
      : "";
  const eta =
    progress && progress.etaSeconds > 0
      ? formatEtaSeconds(progress.etaSeconds)
      : "";

  if (resumable && !progress) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-4",
          className,
        )}
      >
        <div className="w-full max-w-md space-y-3 text-center">
          <p className="truncate text-sm font-medium" title={url}>
            {mediaImportHostLabel(url)}
          </p>
          <p className="text-sm text-muted-foreground">{t("导入已中断")}</p>
          <p className="text-xs text-muted-foreground">
            {t("可以继续上次的下载，已完成的部分不会丢失。")}
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("取消导入")}
            </Button>
            <Button type="button" onClick={onResume}>
              {t("继续")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-4",
        className,
      )}
    >
      <div className="w-full max-w-md space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm" title={url}>
            {mediaImportHostLabel(url)}
          </span>
          {progress ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {percent}%
            </span>
          ) : null}
        </div>
        <Progress value={percent} aria-label={stageLabel} />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-xs text-muted-foreground">
            {stageLabel || t("正在准备导入…")}
          </span>
          <span className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
            {speed ? (
              <span>{t("下载速度 {value1}", { value1: speed })}</span>
            ) : null}
            {eta ? (
              <span>{t("剩余时间 {value1}", { value1: eta })}</span>
            ) : null}
          </span>
        </div>
        <div className="flex justify-end pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t("取消导入")}
          </Button>
        </div>
      </div>
    </div>
  );
}
