// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { VideoNodeData } from "@workspace/interfaces";
import { Video } from "lucide-react";
import { useState } from "react";
import { resolveFileUrl } from "@workspace/api-client";
import { NativeVideoPlayer } from "@workspace/ui/components/media-player/video-player/native-video-player";

// 格式化时长：秒 → mm:ss
function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// 格式化文件大小
function formatSize(bytes: number) {
  if (!bytes || isNaN(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VideoPreview({ node }: { node: VideoNodeData }) {
  // 状态：控制是否播放视频
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="space-y-2">
      {/* 鼠标移入/移出 控制播放 */}
      <div
        className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted"
        onMouseEnter={() => setIsPlaying(true)} // 鼠标进来 → 播放
        onMouseLeave={() => setIsPlaying(false)} // 鼠标离开 → 停止
      >
        {/* 1. 默认显示：封面图 */}
        {!isPlaying && (
          <>
            {node.content?.coverUrl ? (
              <img
                src={resolveFileUrl(node.content.coverUrl)}
                alt={node.title}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Video className="size-8 text-muted-foreground" />
              </div>
            )}

            {/* 时长 */}
            {(node.duration ?? 0) > 0 && (
              <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                {formatDuration(node.duration ?? 0)}
              </div>
            )}
          </>
        )}

        {/* 2. 鼠标移入后显示：视频自动播放（有 HLS 时播放转码后的流）
            这里刻意用原生 `<NativeVideoPlayer>` 而不是节点编辑器里的 video.js
            `<VideoPlayer>`：悬停预览是静音循环的缩略图，挂一个 provider + store +
            控制栏 + 皮肤样式表得不偿失（见 native-video-player.tsx 的说明）。 */}
        {isPlaying && (node.content?.url || node.content?.hlsUrl) && (
          <NativeVideoPlayer
            src={node.content?.url}
            hlsSrc={node.content?.hlsUrl}
            poster={node.content?.coverUrl}
            autoPlay
            muted // 必须静音才能自动播放（浏览器规则）
            loop // 循环播放（更像预览效果）
            controls={false}
            className="size-full object-cover"
          />
        )}

        {/* 播放按钮已完全删除 */}
      </div>

      {/* 底部信息 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="capitalize">{node.source || "Unknown"}</span>
        {(node.fileSize ?? 0) > 0 && (
          <span>{formatSize(node.fileSize ?? 0)}</span>
        )}
      </div>
    </div>
  );
}
