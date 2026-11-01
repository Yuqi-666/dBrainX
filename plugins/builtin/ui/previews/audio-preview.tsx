// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

import type { AudioNodeData } from "@workspace/interfaces";
import { resolveFileUrl } from "@workspace/api-client";

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = (total % 60).toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${mins.toString().padStart(2, "0")}:${secs}`
    : `${mins}:${secs}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AudioPreview({ node }: { node: AudioNodeData }) {
  const { t } = useI18n();

  const url = resolveFileUrl(node.content?.url);
  // A cover only exists on a node imported from a music site; a local upload
  // keeps the full-width player it has always had.
  const coverUrl = node.content?.coverUrl
    ? resolveFileUrl(node.content.coverUrl)
    : "";
  const hasDuration = Number.isFinite(node.duration) && node.duration > 0;
  const hasSize = Number.isFinite(node.fileSize) && node.fileSize > 0;
  return (
    <div className="space-y-2">
      {url ? (
        <div className="flex items-center gap-2">
          {coverUrl && (
            <img
              src={coverUrl}
              alt={node.title || t("封面")}
              loading="lazy"
              draggable={false}
              className="size-12 shrink-0 rounded-md object-cover"
            />
          )}
          <audio
            key={`${node.id}:${url}`}
            src={url}
            controls
            preload="metadata"
            aria-label={translate("{value1}预览", {
              value1: node.title || t("音频"),
            })}
            className="block min-w-0 flex-1"
          />
        </div>
      ) : (
        <div className="rounded-lg bg-muted p-3 text-center text-xs text-muted-foreground">
          {t("暂无音频")}{" "}
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-baseline gap-2">
          <span>{t("时长")}</span>
          <span className="font-medium tabular-nums text-foreground/80">
            {hasDuration ? formatDuration(node.duration) : t("未知")}
          </span>
        </div>
        {hasSize && (
          <span className="tabular-nums">{formatSize(node.fileSize)}</span>
        )}
      </div>
    </div>
  );
}
