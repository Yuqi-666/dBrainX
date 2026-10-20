// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useRef, useState } from "react";
import {
  checkResourceLimit,
  uploadResource,
  type StorageLimits,
} from "@workspace/api-client";
import { toast } from "@workspace/ui/components/ui/toast";
import { categoryLabel } from "./resource-category";
import { formatBytes } from "./format-bytes";

/** Progress of one upload batch, in the shape the header line renders. */
export interface ResourceUploadProgress {
  /** 1-based index of the file being uploaded. */
  current: number;
  /** Number of files accepted into this batch. */
  total: number;
  /** Percent of the current file, 0-100. */
  percent: number;
}

export interface UseResourceUploadResult {
  uploading: boolean;
  progress: ResourceUploadProgress | null;
  /** Validates the picked files, then uploads the accepted ones one by one. */
  uploadFiles: (files: File[]) => void;
}

/**
 * Uploads a batch into the resource library.
 *
 * Validation runs before the first byte is sent, against the limits the server
 * reported, so a rejected file names the category ceiling or the remaining
 * quota instead of failing mid-transfer. Files go one at a time on purpose: the
 * progress line can then name the file being uploaded, and a sequential stream
 * keeps the quota reservation (`projectedBytes`) simple and correct.
 */
export function useResourceUpload({
  limits,
  usedBytes,
  onUploaded,
}: {
  limits: StorageLimits;
  usedBytes: number;
  /** Called once after a batch that stored at least one file. */
  onUploaded: () => void;
}): UseResourceUploadResult {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ResourceUploadProgress | null>(null);
  // A picker can fire while the previous batch is still running; this ref keeps
  // the two batches from interleaving their progress and quota reservations.
  const busy = useRef(false);

  const uploadFiles = useCallback(
    (files: File[]) => {
      if (busy.current || files.length === 0) return;
      busy.current = true;

      void (async () => {
        setUploading(true);

        const accepted: File[] = [];
        let projectedBytes = usedBytes;
        for (const file of files) {
          const violation = checkResourceLimit(file, limits);
          if (violation) {
            toast({
              title: t("无法上传文件"),
              description: t(
                "“{value1}”超出{value2}类文件的上限（{value3}）。",
                {
                  value1: file.name,
                  value2: categoryLabel(violation.category, t),
                  value3: formatBytes(violation.limitBytes),
                },
              ),
              variant: "destructive",
            });
            continue;
          }
          if (
            limits.userQuotaBytes > 0 &&
            projectedBytes + file.size > limits.userQuotaBytes
          ) {
            toast({
              title: t("存储空间不足"),
              description: t(
                "存储空间不足：“{value1}”需要 {value2}，剩余 {value3}。",
                {
                  value1: file.name,
                  value2: formatBytes(file.size),
                  value3: formatBytes(
                    Math.max(0, limits.userQuotaBytes - projectedBytes),
                  ),
                },
              ),
              variant: "destructive",
            });
            continue;
          }
          projectedBytes += file.size;
          accepted.push(file);
        }

        let uploaded = 0;
        let failed = 0;
        for (const [index, file] of accepted.entries()) {
          setProgress({
            current: index + 1,
            total: accepted.length,
            percent: 0,
          });
          try {
            await uploadResource(file, (event) => {
              setProgress({
                current: index + 1,
                total: accepted.length,
                percent: Math.round(event.progress),
              });
            });
            uploaded += 1;
          } catch {
            failed += 1;
            toast({
              title: t("上传失败"),
              description: t("“{value1}”上传失败，请重试。", {
                value1: file.name,
              }),
              variant: "destructive",
            });
          }
        }

        setProgress(null);
        setUploading(false);
        busy.current = false;

        if (uploaded > 0 || failed > 0) {
          toast({
            title: t("上传完成"),
            description:
              failed > 0
                ? t("已上传 {value1} 个文件，{value2} 个失败。", {
                    value1: uploaded,
                    value2: failed,
                  })
                : t("已上传 {value1} 个文件。", { value1: uploaded }),
            variant: failed > 0 ? "destructive" : "default",
          });
        }
        if (uploaded > 0) onUploaded();
      })();
    },
    [limits, usedBytes, onUploaded, t],
  );

  return { uploading, progress, uploadFiles };
}
