// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useState } from "react";
import { VideoOff } from "lucide-react";
import type { VideoNodeData } from "@workspace/interfaces";

import { VideoPlayer } from "@workspace/ui/components/media-player/video-player/video-player";
import { cn } from "@workspace/ui/lib/utils";
import { resolveFileUrl } from "@workspace/api-client";

import { FileDropZone } from "./file-drop-zone";
import { MediaNodeLayout } from "./media-node-layout";
import { useMediaTimestamps } from "./use-media-timestamps";

interface VideoNodeContentProps {
  node: VideoNodeData;
  className?: string;
}

/**
 * A video node: the video.js v10 `<VideoPlayer>` beside the timestamp sidebar
 * (design `node-content/README.md` §1.4, plan `media.md` §M6.1-5).
 *
 * The player owns the seek bar, so the note ticks are drawn **inside it**
 * (`media-player/note-marks.tsx`) and a tick's click reaches the sidebar through
 * `onActivateNote` → `focusRequest`. The host keeps three jobs:
 *
 * - **Composition and persistence** — `MediaNodeLayout` + `useMediaTimestamps`
 *   (one gesture, one write; `Mod-Enter` captured on the content box).
 * - **Sources** — the HLS playlist when the backend packaged one, the original
 *   upload otherwise.
 * - **The two failure screens.** An element that decoded audio but no video
 *   (`videoWidth === 0`) and one that could not load at all both need a way out
 *   — the original upload — which the player does not know about.
 *
 * The loading skeleton M6 drew is gone: the skin shows the node's `coverUrl` as
 * its poster and its own buffering indicator, which is both the video.js
 * behaviour and a poster the user gets to see (the skeleton hid it until
 * `loadeddata`).
 */
export function VideoNodeContent({ node, className }: VideoNodeContentProps) {
  const { t } = useI18n();

  const [undecodable, setUndecodable] = useState(false);
  const [failed, setFailed] = useState(false);

  const url = resolveFileUrl(node.content?.url);
  const hlsUrl = resolveFileUrl(node.content?.hlsUrl);
  // Either representation makes the node playable: the HLS playlist the backend
  // packaged, or the original upload it was packaged from.
  const hasSource = !!url || !!hlsUrl;

  // A record with no content half is malformed, not the normal case; the
  // fallback keeps the timestamp layer from reading through `undefined`.
  const content = node.content ?? { url: "", coverUrl: "" };

  const timestamps = useMediaTimestamps(node, content);

  // A new source deserves a fresh verdict. Without this the "cannot decode"
  // screen is terminal for the component instance — it renders no player, so
  // nothing can ever clear the flag — while the attributes sidebar can point the
  // node at a different file without remounting it (the node editor only keys on
  // `node.id`). Pre-existing; found by the M6 probe (G6-8).
  useEffect(() => {
    setUndecodable(false);
    setFailed(false);
  }, [url, hlsUrl]);

  if (!hasSource) {
    return (
      <FileDropZone
        nodeId={node.id}
        accept=".mp4,.webm,.mov,video/*"
        variant="video"
        className={cn("w-full h-full min-h-[200px]", className)}
      />
    );
  }

  if (undecodable || failed) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 p-6 text-center",
          className,
        )}
      >
        <VideoOff className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {undecodable
            ? t("当前浏览器无法解码该视频的编码，只有音轨可以播放。")
            : t("视频加载失败，可能是网络或文件本身的问题。")}
        </p>
        {url && (
          <a
            href={url}
            download
            className="text-sm text-primary underline underline-offset-4 hover:no-underline"
          >
            {t("下载原文件")}{" "}
          </a>
        )}
      </div>
    );
  }

  return (
    <MediaNodeLayout
      className={className}
      timestamps={timestamps.timestamps}
      onTimestampsChange={timestamps.onTimestampsChange}
      controller={timestamps.controller}
      addRequest={timestamps.addRequest}
      focusRequest={timestamps.focusRequest}
      onConvertNote={timestamps.onCreateNodeFromNote}
      onOpenNode={timestamps.onOpenNode}
      onKeyDown={timestamps.onKeyDown}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <VideoPlayer
          src={url}
          hlsSrc={hlsUrl}
          poster={node.content?.coverUrl}
          controls
          className="h-full w-full"
          onLoadedData={(size) => {
            // An element that decoded audio but no video reports 0×0: it renders
            // a bare control bar, which is what an unplayable codec looks like.
            setUndecodable(size.videoWidth === 0 && size.videoHeight === 0);
          }}
          onError={() => setFailed(true)}
          onMediaController={timestamps.onMediaController}
          notes={timestamps.notes}
          subtitles={timestamps.subtitles}
          onAddNoteRequest={timestamps.onAddNoteRequest}
          onActivateNote={timestamps.onActivateNote}
        />
      </div>
    </MediaNodeLayout>
  );
}
