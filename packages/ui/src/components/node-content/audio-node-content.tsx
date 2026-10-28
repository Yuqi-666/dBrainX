// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useState } from "react";
import { FileAudio } from "lucide-react";
import type { AudioNodeData } from "@workspace/interfaces";

import { AudioPlayer } from "@workspace/ui/components/media-player/audio-player/audio-player";
import { cn } from "@workspace/ui/lib/utils";
import { resolveFileUrl } from "@workspace/api-client";

import { FileDropZone } from "./file-drop-zone";
import { MediaNodeLayout } from "./media-node-layout";
import { useMediaTimestamps } from "./use-media-timestamps";

interface AudioNodeContentProps {
  node: AudioNodeData;
  className?: string;
}

/**
 * An audio node: the video.js v10 `<AudioPlayer>` beside the timestamp sidebar
 * (design `node-content/README.md` §1.3, plan `media.md` §M6.1-5).
 *
 * The self-drawn transport M6 shipped is gone: the audio preset of video.js v10
 * provides the progress bar the timestamp layer needs (its `TimeSlider` is the
 * component the ticks are drawn into), so the two players differ only in their
 * media element and their control layout, not in how a note is anchored or
 * reached.
 *
 * The host's whole job is composition and persistence — `MediaNodeLayout` and
 * `useMediaTimestamps` — plus the one failure screen an `<audio>` element needs.
 * M6's loading skeleton is gone: the skin's own buffering indicator covers it,
 * and the skeleton used to hide the control bar until `loadeddata`.
 */
export function AudioNodeContent({ node, className }: AudioNodeContentProps) {
  const { t } = useI18n();

  const [failed, setFailed] = useState(false);

  const url = resolveFileUrl(node.content?.url);
  const hasUrl = !!url;
  // The music-site import saves the artwork as a derived file; a local upload
  // has none, in which case nothing is rendered and the player keeps its
  // current centred layout (audio-import-design.md §8).
  const coverUrl = node.content?.coverUrl
    ? resolveFileUrl(node.content.coverUrl)
    : "";

  // A record with no content half is malformed, not the normal case; the
  // fallback keeps the timestamp layer from reading through `undefined`.
  const content = node.content ?? { url: "" };

  const timestamps = useMediaTimestamps(node, content);

  if (!hasUrl) {
    return (
      <FileDropZone
        nodeId={node.id}
        accept=".mp3,.wav,.ogg,.m4a,audio/*"
        variant="audio"
        className={cn("w-full h-full min-h-[100px]", className)}
      />
    );
  }

  if (failed) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 p-6 text-center",
          className,
        )}
      >
        <FileAudio className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t("音频加载失败，可能是网络或文件本身的问题。")}{" "}
        </p>
        <a
          href={url}
          download
          className="text-sm text-primary underline underline-offset-4 hover:no-underline"
        >
          {t("下载原文件")}{" "}
        </a>
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
      {/*
        The bar sits in the middle of the column, not at the top: the shipped
        audio skin is `height: auto !important` — it hugs the control bar — so
        anchoring it to the top would only park it under the header and leave the
        rest of the pane empty. `flex-1` takes the column's height and
        `justify-center` centres the bar in it (the default `align-items:
        stretch` keeps the bar full-width; `items-center` would shrink it to its
        content instead).
      */}
      <div className="@container relative flex min-h-0 flex-1 flex-col justify-center">
        {/*
          The cover sits above the control bar and only exists on an imported
          node. It is hidden in a narrow container (`@md` queries this box, not
          the viewport) so the bar keeps its whole width in the small dialog.
          When there is no cover this element is not rendered at all, which is
          what keeps the layout byte-for-byte unchanged for local uploads.
        */}
        {coverUrl && (
          <div className="mb-4 hidden shrink-0 justify-center @md:flex">
            <img
              src={coverUrl}
              alt={node.title || t("封面")}
              loading="lazy"
              draggable={false}
              className="size-32 rounded-lg object-cover shadow-sm"
            />
          </div>
        )}
        <AudioPlayer
          src={url}
          onMediaController={timestamps.onMediaController}
          onError={() => setFailed(true)}
          notes={timestamps.notes}
          onAddNoteRequest={timestamps.onAddNoteRequest}
          onActivateNote={timestamps.onActivateNote}
        />
      </div>
    </MediaNodeLayout>
  );
}
