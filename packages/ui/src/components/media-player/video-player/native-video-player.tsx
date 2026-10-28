// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * Plays a video in a bare `<video>` element, preferring its HLS playlist when
 * it has one.
 *
 * This is the M6 implementation (`video-player.tsx` before the video.js v10
 * player took that name) and it is still the right tool for one caller: the
 * hover preview (`preview-block/previews/video-preview.tsx`). A preview is a
 * muted, looping thumbnail that exists only while the pointer is over it, so a
 * v10 player — a provider, a store, a control bar and its stylesheet — would be
 * a large amount of machinery for a background element. The node editor, where
 * a timeline and its notes matter, uses `<VideoPlayer>`.
 *
 * A node's source blob is whatever was uploaded, and the codec a recording
 * device picked is not necessarily one the browser can decode — a phone writing
 * HEVC plays its audio track and reports `videoWidth === 0`, which looks like a
 * broken audio player. The backend therefore packages uploads as HLS in a codec
 * browsers decode; this component is the playback half of that deal:
 *
 * - `hlsSrc` set and MSE available → hls.js drives the element (never the
 *   browser's own HLS support, which desktop Chromium lacks entirely);
 * - `hlsSrc` set, no MSE but native HLS (Safari) → the element plays it itself;
 * - no playlist yet → the progressive `src` is played as before, so an
 *   untranscoded node and every existing record keep working.
 *
 * hls.js is imported lazily: it is a heavy dependency that only a node with a
 * playlist ever pulls in.
 */
import { useEffect, useRef } from "react";

import { resolveFileUrl } from "@workspace/api-client";
import { cn } from "@workspace/ui/lib/utils";

import { createMediaController } from "../types";

import type { MediaControllerCallback } from "../types";
import type Hls from "hls.js";

interface NativeVideoPlayerProps {
  /** Progressive source, used when there is no playlist (or no MSE support). */
  src?: string;
  /** HLS playlist (`/api/files/…/index.m3u8`), preferred when present. */
  hlsSrc?: string;
  poster?: string;
  className?: string;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  playsInline?: boolean;
  /** Fired once the element has data — including when it decodes audio only. */
  onLoadedData?: React.ReactEventHandler<HTMLVideoElement>;
  /** Fired when neither the playlist nor the progressive source can be played. */
  onError?: () => void;
  /**
   * The time outlet: the controller bound to this element, or `null` on unmount
   * (`media-player/types.ts`). Optional — the previews call this component without it.
   */
  onMediaController?: MediaControllerCallback;
}

export function NativeVideoPlayer({
  src,
  hlsSrc,
  poster,
  className,
  controls = true,
  autoPlay = false,
  muted = false,
  loop = false,
  playsInline = true,
  onLoadedData,
  onError,
  onMediaController,
}: NativeVideoPlayerProps) {
  const { t } = useI18n();

  const videoRef = useRef<HTMLVideoElement>(null);
  // Kept in a ref so a re-render does not re-attach the source; the effect must
  // depend on the sources alone.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // Same discipline for the time outlet: a host that rebuilds its handler on
  // every render must not rebuild the controller.
  const onMediaControllerRef = useRef(onMediaController);
  onMediaControllerRef.current = onMediaController;

  // Built once for the element's own lifetime. It deliberately does not live in
  // the source effect below: the sources change on every transcode while the
  // element stays the same, and a controller rebuilt there would drop the
  // host's subscriptions mid-playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const controller = createMediaController(video);
    onMediaControllerRef.current?.(controller);

    return () => {
      onMediaControllerRef.current?.(null);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playlist = hlsSrc ? resolveFileUrl(hlsSrc) : "";
    const fallback = src ? resolveFileUrl(src) : "";

    // A new source must not inherit the previous one's buffer.
    video.removeAttribute("src");
    video.load();

    let hls: Hls | undefined;
    let disposed = false;

    const attach = async () => {
      if (!playlist) {
        if (fallback) video.src = fallback;
        return;
      }

      const { default: HlsPlayer } = await import("hls.js");
      if (disposed) return;

      if (HlsPlayer.isSupported()) {
        hls = new HlsPlayer({ enableWorker: true });
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          // A fatal playlist/segment failure still has the original upload to
          // fall back on, so only report when there is nothing else to play.
          if (fallback && video.currentSrc !== fallback) {
            hls?.destroy();
            hls = undefined;
            video.src = fallback;
            return;
          }
          onErrorRef.current?.();
        });
        hls.loadSource(playlist);
        hls.attachMedia(video);
        return;
      }

      // Safari and iOS play HLS natively; everywhere else the progressive file
      // is the only remaining option.
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playlist;
      } else if (fallback) {
        video.src = fallback;
      }
    };

    void attach();

    return () => {
      disposed = true;
      hls?.destroy();
    };
  }, [src, hlsSrc]);

  return (
    <video
      ref={videoRef}
      poster={poster ? resolveFileUrl(poster) : undefined}
      className={cn("block", className)}
      controls={controls}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      playsInline={playsInline}
      onLoadedData={onLoadedData}
      onError={() => onErrorRef.current?.()}
    >
      {t("您的浏览器不支持视频播放")}{" "}
    </video>
  );
}
